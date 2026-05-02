import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const runMutation = process.env.RUN_MUTATION_TESTS === 'true'

if (!url || !key) {
  console.error('❌ Missing env vars: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key)

function pass(message) {
  console.log(`✅ ${message}`)
}

function warn(message) {
  console.log(`⚠️  ${message}`)
}

function fail(message) {
  console.log(`❌ ${message}`)
  process.exitCode = 1
}

async function requireNoError(label, result) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`)
  }
  return result.data
}

async function getSeedUserId() {
  const { data, error } = await supabase
    .from('boxes')
    .select('user_id')
    .not('user_id', 'is', null)
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Find seed user_id: ${error.message}`)
  if (!data?.user_id) {
    throw new Error('No existing boxes.user_id found. Create one normal paid bin first, then rerun mutation sanity.')
  }

  return data.user_id
}

async function cleanupTempRows(tempBoxId, shipmentIds = []) {
  await supabase.from('shipment_boxes').delete().eq('box_id', tempBoxId)

  for (const shipmentId of shipmentIds.filter(Boolean)) {
    await supabase.from('shipments').delete().eq('id', shipmentId)
  }

  await supabase.from('boxes').delete().eq('id', tempBoxId)
}

async function runReadOnlyChecks() {
  console.log('StorkBin automated sanity check')
  console.log('Mode: read-only DB/state-machine checks')
  console.log('')

  const checks = [
    ['boxes exposes required columns', supabase.from('boxes').select('id,user_id,status,fulfillment_status,checkout_status,lifecycle_status').limit(1)],
    ['shipments exposes required columns', supabase.from('shipments').select('id,shipment_direction,shipping_status,charge_status,label_status').limit(1)],
    ['shipment_boxes exposes required columns', supabase.from('shipment_boxes').select('shipment_id,box_id,user_id').limit(1)],
    ['admin_ops_bins exposes required columns', supabase.from('admin_ops_bins').select('id,latest_shipment_id,latest_shipment_direction,latest_shipping_status,latest_charge_status,latest_label_status').limit(1)],
  ]

  let failures = 0
  let warnings = 0
  let checkCount = 0

  for (const [label, query] of checks) {
    checkCount += 1
    const { error } = await query
    if (error) {
      failures += 1
      fail(`${label}: ${error.message}`)
    } else {
      pass(label)
    }
  }

  const optionalLifecycle = await supabase.from('admin_ops_bins').select('lifecycle_last_notified_at').limit(1)
  checkCount += 1
  if (optionalLifecycle.error) {
    warnings += 1
    warn('admin_ops_bins does not expose optional lifecycle_last_notified_at; customer grace logic can still use boxes directly')
  } else {
    pass('admin_ops_bins exposes optional lifecycle_last_notified_at')
  }

  const boxesResult = await supabase
    .from('boxes')
    .select('id,user_id,status,fulfillment_status,checkout_status,lifecycle_status,cancellation_shipping_charge_status,cancellation_shipping_charge_failed_at,last_payment_failed_at,lifecycle_deadline_at')
    .limit(50)

  checkCount += 1
  if (boxesResult.error) {
    failures += 1
    fail(`Could not load boxes for lifecycle checks: ${boxesResult.error.message}`)
  } else {
    pass(`Loaded ${boxesResult.data.length} boxes for lifecycle checks`)
  }

  const shipmentsResult = await supabase
    .from('shipments')
    .select('id,shipment_direction,shipping_status,charge_status,label_status')
    .limit(50)

  checkCount += 1
  if (shipmentsResult.error) {
    failures += 1
    fail(`Could not load shipments for logistics checks: ${shipmentsResult.error.message}`)
  } else {
    pass(`Loaded ${shipmentsResult.data.length} shipments for logistics checks`)
  }

  const adminRowsResult = await supabase
    .from('admin_ops_bins')
    .select('id,latest_shipment_id,latest_shipment_direction,latest_shipping_status,latest_charge_status')
    .limit(100)

  checkCount += 1
  if (adminRowsResult.error) {
    failures += 1
    fail(`Could not sample admin_ops_bins rows: ${adminRowsResult.error.message}`)
  } else {
    const ids = adminRowsResult.data.map((row) => row.id)
    const uniqueIds = new Set(ids)
    if (ids.length !== uniqueIds.size) {
      failures += 1
      fail('admin_ops_bins returned duplicate box rows in sampled data')
    } else {
      pass('admin_ops_bins returns one row per box in sampled data')
    }
  }

  const boxes = boxesResult.data || []
  const failedPaymentBoxes = boxes.filter((box) => (
    box.cancellation_shipping_charge_status === 'failed' ||
    box.last_payment_failed_at ||
    box.lifecycle_deadline_at
  ))

  checkCount += 1
  if (failedPaymentBoxes.length) {
    const box = failedPaymentBoxes[0]
    if (box.lifecycle_deadline_at) {
      pass(`Failed-payment box ${box.id} has grace deadline ${box.lifecycle_deadline_at}`)
    } else {
      warnings += 1
      warn(`Failed-payment box ${box.id} has no lifecycle_deadline_at`)
    }
  } else {
    warn('No failed-payment/grace-period boxes found in sample')
    warnings += 1
  }

  const visiblePaidBoxes = boxes.filter((box) => (
    box.checkout_status === 'paid' &&
    box.lifecycle_status !== 'removed_from_system'
  ))

  checkCount += 1
  pass(`Customer My Bins eligibility sample: ${visiblePaidBoxes.length} paid non-removed boxes`)

  const shipmentBoxesResult = await supabase
    .from('shipment_boxes')
    .select('shipment_id,box_id')
    .limit(500)

  checkCount += 1
  if (shipmentBoxesResult.error) {
    failures += 1
    fail(`Could not load shipment_boxes grouping data: ${shipmentBoxesResult.error.message}`)
  } else if (shipmentBoxesResult.data.length) {
    const counts = new Map()
    for (const row of shipmentBoxesResult.data) {
      counts.set(row.shipment_id, (counts.get(row.shipment_id) || 0) + 1)
    }
    const maxGroup = Math.max(...counts.values())
    if (maxGroup <= 3) {
      pass(`Grouped shipment rule respected in sampled data: max ${maxGroup} boxes per shipment`)
    } else {
      failures += 1
      fail(`Grouped shipment rule violated in sample: shipment has ${maxGroup} boxes`)
    }
  } else {
    warnings += 1
    warn('No shipment_boxes rows found; grouped shipment check could not run')
  }

  console.log('')
  console.log(`Result: ${failures} failure(s), ${warnings} warning(s), ${checkCount} check(s)`)

  if (failures > 0) process.exit(1)
}

async function runMutationChecks() {
  console.log('StorkBin automated sanity check')
  console.log('Mode: mutation test (writes data)')
  console.log('Running mutation test...')

  const seedUserId = await getSeedUserId()
  const tempBoxId = `sanity-${Date.now()}`
  const createdShipmentIds = []

  try {
    await requireNoError('Create temp box', await supabase.from('boxes').insert({
      id: tempBoxId,
      user_id: seedUserId,
      box_number: `SANITY-${Date.now()}`,
      status: 'stored',
      fulfillment_status: 'stored',
      checkout_status: 'paid',
      lifecycle_status: 'active'
    }))

    const outboundShipment = await requireNoError(
      'Create outbound shipment',
      await supabase
        .from('shipments')
        .insert({
          user_id: seedUserId,
          shipment_direction: 'to_customer',
          shipping_status: 'paid',
          charge_status: 'paid',
          label_status: 'needed'
        })
        .select('id')
        .single()
    )
    createdShipmentIds.push(outboundShipment.id)

    await requireNoError('Link outbound shipment box', await supabase.from('shipment_boxes').insert({
      shipment_id: outboundShipment.id,
      box_id: tempBoxId,
      user_id: seedUserId,
      stack_position: 1
    }))

    await requireNoError('RPC admin_generate_label outbound', await supabase.rpc('admin_generate_label', {
      p_shipment_id: outboundShipment.id
    }))
    await requireNoError('RPC admin_mark_shipment_in_transit outbound', await supabase.rpc('admin_mark_shipment_in_transit', {
      p_shipment_id: outboundShipment.id
    }))
    await requireNoError('RPC admin_mark_shipment_delivered outbound', await supabase.rpc('admin_mark_shipment_delivered', {
      p_shipment_id: outboundShipment.id
    }))

    const outboundBox = await requireNoError(
      'Verify outbound box state',
      await supabase
        .from('boxes')
        .select('status, fulfillment_status')
        .eq('id', tempBoxId)
        .single()
    )

    if (outboundBox.status !== 'at_customer' || outboundBox.fulfillment_status !== 'bin_with_customer') {
      throw new Error(`Outbound delivered expected at_customer/bin_with_customer, got ${outboundBox.status}/${outboundBox.fulfillment_status}`)
    }
    pass('Outbound shipment lifecycle moved linked box to at_customer/bin_with_customer')

    const returnShipment = await requireNoError(
      'Create return shipment',
      await supabase
        .from('shipments')
        .insert({
          user_id: seedUserId,
          shipment_direction: 'to_storage',
          shipping_status: 'paid',
          charge_status: 'paid',
          label_status: 'needed'
        })
        .select('id')
        .single()
    )
    createdShipmentIds.push(returnShipment.id)

    await requireNoError('Link return shipment box', await supabase.from('shipment_boxes').insert({
      shipment_id: returnShipment.id,
      box_id: tempBoxId,
      user_id: seedUserId,
      stack_position: 1
    }))

    await requireNoError('RPC admin_generate_label return', await supabase.rpc('admin_generate_label', {
      p_shipment_id: returnShipment.id
    }))
    await requireNoError('RPC admin_mark_shipment_in_transit return', await supabase.rpc('admin_mark_shipment_in_transit', {
      p_shipment_id: returnShipment.id
    }))
    await requireNoError('RPC admin_mark_shipment_delivered return', await supabase.rpc('admin_mark_shipment_delivered', {
      p_shipment_id: returnShipment.id
    }))

    const returnBox = await requireNoError(
      'Verify return box state',
      await supabase
        .from('boxes')
        .select('status, fulfillment_status')
        .eq('id', tempBoxId)
        .single()
    )

    if (returnBox.status !== 'stored' || returnBox.fulfillment_status !== 'stored') {
      throw new Error(`Return delivered expected stored/stored, got ${returnBox.status}/${returnBox.fulfillment_status}`)
    }
    pass('Return shipment lifecycle moved linked box to stored/stored')

    await cleanupTempRows(tempBoxId, createdShipmentIds)
    pass('Temporary mutation test rows cleaned up')
    console.log('')
    console.log('Result: 0 failure(s), 0 warning(s), mutation fixture passed')
  } catch (error) {
    await cleanupTempRows(tempBoxId, createdShipmentIds)
    throw error
  }
}

if (runMutation) {
  runMutationChecks().catch((error) => {
    console.error(`❌ ${error.message}`)
    process.exit(1)
  })
} else {
  runReadOnlyChecks().catch((error) => {
    console.error(`❌ ${error.message}`)
    process.exit(1)
  })
}

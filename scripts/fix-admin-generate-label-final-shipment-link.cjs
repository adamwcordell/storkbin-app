const fs = require('fs');
const path = require('path');

const root = process.cwd();
const appPath = path.join(root, 'src', 'App.jsx');
const sweepPath = path.join(root, 'supabase', 'functions', 'sweep-final-shipments', 'index.ts');

function replaceOnce(filePath, search, replacement, label) {
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text.includes(search)) {
    if (text.includes(replacement.trim().split('\n')[0])) {
      console.log(`${label}: already patched`);
      return false;
    }
    throw new Error(`${label}: expected block not found`);
  }
  fs.writeFileSync(filePath, text.replace(search, replacement));
  console.log(`${label}: patched`);
  return true;
}

const appSearch = `

  const generateLabel = async (shipment, box) => {
    if (!shipment?.id) {
      alert("Shipment not found.");
      return;
    }

    const confirmed = window.confirm("Generate label for this shipment?");
    if (!confirmed) return;

    const { error } = await supabase.rpc("admin_generate_label", {
      p_shipment_id: shipment.id,
    });
`;

const appReplacement = `

  const ensureShipmentBoxLink = async (shipment, box) => {
    const shipmentId = shipment?.id;
    const boxId = shipment?.box_id || box?.id;
    const userId = shipment?.user_id || box?.user_id;

    if (!shipmentId || !boxId || !userId) {
      return { ok: true };
    }

    const { data: existingRows, error: lookupError } = await supabase
      .from("shipment_boxes")
      .select("shipment_id")
      .eq("shipment_id", shipmentId)
      .eq("box_id", boxId)
      .limit(1);

    if (lookupError) {
      return { ok: false, error: lookupError };
    }

    if (existingRows?.length) {
      return { ok: true };
    }

    const { error: insertError } = await supabase.from("shipment_boxes").insert([
      {
        shipment_id: shipmentId,
        box_id: boxId,
        user_id: userId,
        stack_position: 1,
      },
    ]);

    return insertError ? { ok: false, error: insertError } : { ok: true };
  };

  const generateLabel = async (shipment, box) => {
    if (!shipment?.id) {
      alert("Shipment not found.");
      return;
    }

    const confirmed = window.confirm("Generate label for this shipment?");
    if (!confirmed) return;

    const linkResult = await ensureShipmentBoxLink(shipment, box);
    if (!linkResult.ok) {
      alert(linkResult.error?.message || "Could not link this shipment to its bin before label generation.");
      return;
    }

    const { error } = await supabase.rpc("admin_generate_label", {
      p_shipment_id: shipment.id,
    });
`;

replaceOnce(appPath, appSearch, appReplacement, 'App.jsx generateLabel shipment_boxes guard');

const sweepHelperSearch = `
const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
`;

const sweepHelperReplacement = `
const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const ensureShipmentBoxLink = async (supabase: ReturnType<typeof createClient>, shipmentId: string, box: any) => {
  const { data: existingRows, error: lookupError } = await supabase
    .from("shipment_boxes")
    .select("shipment_id")
    .eq("shipment_id", shipmentId)
    .eq("box_id", box.id)
    .limit(1);

  if (lookupError) {
    throw new Error("Could not check final shipment link for " + box.id + ": " + lookupError.message);
  }

  if (existingRows?.length) return;

  const { error: insertError } = await supabase.from("shipment_boxes").insert([
    {
      shipment_id: shipmentId,
      box_id: box.id,
      user_id: box.user_id,
      stack_position: 1,
    },
  ]);

  if (insertError) {
    throw new Error("Could not link final shipment to " + box.id + ": " + insertError.message);
  }
};
`;

replaceOnce(sweepPath, sweepHelperSearch, sweepHelperReplacement, 'sweep-final-shipments helper');

const sweepExistingSearch = `
    if (existingShipments && existingShipments.length > 0) {
      results.push({
        boxId: box.id,
        skipped: true,
        reason: "open final shipment already exists",
        shipmentId: existingShipments[0].id,
      });
      continue;
    }
`;

const sweepExistingReplacement = `
    if (existingShipments && existingShipments.length > 0) {
      await ensureShipmentBoxLink(supabase, existingShipments[0].id, box);

      results.push({
        boxId: box.id,
        skipped: true,
        reason: "open final shipment already exists",
        shipmentId: existingShipments[0].id,
        linked: true,
      });
      continue;
    }
`;

replaceOnce(sweepPath, sweepExistingSearch, sweepExistingReplacement, 'sweep-final-shipments existing-shipment link');

const sweepCreatedSearch = `
    if (shipmentCreateError) {
      throw new Error(` + '`' + `Could not create final shipment for \${box.id}: \${shipmentCreateError.message}` + '`' + `);
    }

    const { error: boxUpdateError } = await supabase
`;

const sweepCreatedReplacement = `
    if (shipmentCreateError) {
      throw new Error(` + '`' + `Could not create final shipment for \${box.id}: \${shipmentCreateError.message}` + '`' + `);
    }

    await ensureShipmentBoxLink(supabase, createdShipment.id, box);

    const { error: boxUpdateError } = await supabase
`;

replaceOnce(sweepPath, sweepCreatedSearch, sweepCreatedReplacement, 'sweep-final-shipments created-shipment link');

console.log('Done. Final shipments will now have shipment_boxes links before label generation.');

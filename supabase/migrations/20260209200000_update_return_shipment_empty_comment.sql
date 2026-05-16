-- Align DB comment with product dims (empty flat 27x17x4 in, stacked for rating)
comment on column public.boxes.return_shipment_empty is
  'When true and cart_type is return_to_storage, bin is shipped back empty/flat (27x17x4 in, 9 lb quote each); up to 5 per label rated as one stacked package.';

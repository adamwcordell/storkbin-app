-- Customer-declared empty flat return (affects FedEx dims + checkout bundling)
alter table public.boxes
  add column if not exists return_shipment_empty boolean not null default false;

comment on column public.boxes.return_shipment_empty is
  'When true and cart_type is return_to_storage, bin is shipped back empty/flat (26x17x4) and may bundle up to 5 per label.';

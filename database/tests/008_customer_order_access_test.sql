\set ON_ERROR_STOP on
begin;
do $$
declare category_id uuid; product_id uuid; location_id uuid; cart_record carts;
  first_checkout record; replay record; order_json jsonb;
  cart_hash constant text := repeat('a',64); order_hash constant text := repeat('b',64);
begin
  insert into product_categories(name,slug) values ('Brake Pads','brake-pads') returning id into category_id;
  insert into products(category_id,sku,slug,name,short_description,description,product_kind,axle_position,publication_status,owner_verified_at,owner_verified_by)
  values(category_id,'ACC-TEST','access-test','FIAA Accessory','Verified accessory','Verified description','accessory','not_applicable','draft',now(),'schema-test') returning id into product_id;
  insert into product_prices(product_id,currency,amount_minor,valid_from,approved_at,approved_by) values(product_id,'NGN',125000,now(),now(),'schema-test');
  insert into inventory_locations(code,name) values('MAIN','Main') returning id into location_id;
  insert into inventory(product_id,location_id,quantity_on_hand) values(product_id,location_id,10);
  insert into product_images(product_id,storage_key,alt_text,image_role,width_px,height_px,mime_type,position,owner_verified_at)
  values(product_id,'products/access-test.webp','FIAA accessory','primary',1200,900,'image/webp',0,now());
  update products set publication_status='published',published_at=now() where id=product_id;
  insert into delivery_methods(code,name,fee_minor,currency,requires_address) values('lagos','Lagos delivery',250000,'NGN',true);
  select * into cart_record from create_anonymous_cart(cart_hash,interval '1 day');
  perform set_cart_item(cart_record.id,cart_hash,'ACC-TEST',2);
  select * into first_checkout from create_customer_checkout(cart_record.id,cart_hash,repeat('i',32),order_hash,'Ada Okafor','+2348012345678','ada@example.com','lagos','12 Test Street',null,'Lagos','Lagos');
  if not first_checkout.was_created then raise exception 'First checkout not created'; end if;
  select * into replay from create_customer_checkout(cart_record.id,cart_hash,repeat('i',32),repeat('c',64),'Ada Okafor','+2348012345678','ada@example.com','lagos','12 Test Street',null,'Lagos','Lagos');
  if replay.was_created or replay.order_id <> first_checkout.order_id then raise exception 'Replay was not idempotent'; end if;
  if (select token_hash from order_access_tokens where order_id=first_checkout.order_id) <> order_hash then raise exception 'Replay replaced token'; end if;
  select get_customer_order(o.order_number,order_hash) into order_json from orders o where o.id=first_checkout.order_id;
  if order_json->>'status' <> 'pending_payment' or (order_json->>'totalMinor')::bigint <> 500000 then raise exception 'Wrong order projection: %',order_json; end if;
  begin
    perform get_customer_order((select order_number from orders where id=first_checkout.order_id),repeat('d',64));
    raise exception 'Invalid token read order';
  exception when sqlstate 'P0001' then null; end;
end; $$;
rollback;

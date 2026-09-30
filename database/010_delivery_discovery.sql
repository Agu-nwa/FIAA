-- Public checkout delivery choices. Apply after 009_application_roles.sql.
begin;

create view public_delivery_methods as
select code, name, description, fee_minor, trim(currency) as currency, requires_address
from delivery_methods
where is_active = true
order by name;

grant select on public_delivery_methods to fiaa_api;
revoke all on delivery_methods from fiaa_api;

comment on view public_delivery_methods is
'Exposes only active owner-configured delivery choices and approved fees to checkout.';

commit;

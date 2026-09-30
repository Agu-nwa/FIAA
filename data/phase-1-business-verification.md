# FIAA Evolution — Phase 1 production verification

Nothing in the draft registers is publishable merely because it appears in the files. A product becomes publishable only after FIAA confirms the required commercial and fitment fields and changes `publish_status` to `approved`.

## Catalogue evidence received

- `IMG_4473.HEIC`, catalogue page 27: Mazda brake-pad references.
- `IMG_4474.HEIC`, catalogue page 91: Daihatsu, BMW and Mini references. Several product numbers are cropped and require a clearer photograph.
- `IMG_4475.HEIC`, catalogue page 100: Cadillac, Acura, Buick, Chevrolet and GMC references.
- The photographs establish the intended catalogue pattern: product number → OEM references → pad image/drawing → dimensions → compatible vehicles.
- The photographs do not establish FIAA selling price, live stock, warranty, year/engine coverage in every row, or front/rear position in most rows.

## Required product approval fields

For every brake product:

- FIAA product number exactly as printed on the FIAA pack
- Product type: pad, shoe or fitting kit
- Front or rear position
- OEM references
- Width × height × thickness in millimetres
- Vehicle make, model, year range, engine and trim exceptions
- Selling price in naira
- Stock quantity or approved stock-status rule
- Genuine product and pack photographs
- Warranty terms
- Published or unpublished decision

For every accessory:

- Confirmation that FIAA actually sells the item
- Final product name and internal code/SKU
- Brand and model where applicable
- Exact specification, options and package contents
- Selling price and stock quantity
- Genuine photographs
- Warranty and return eligibility
- Published or unpublished decision

## Required business decisions

1. **Ordering:** online payment, WhatsApp-assisted order, pay-on-delivery, bank transfer, or an approved combination.
2. **Payments:** chosen payment provider, settlement account, refund handling and failed-payment workflow.
3. **Delivery:** service areas, delivery partners, pricing rules, estimated times and shop pickup rules.
4. **Tax and invoicing:** whether displayed prices include taxes and what receipt/invoice information is required.
5. **Inventory:** exact quantities versus simple in-stock/out-of-stock status; overselling policy.
6. **Returns:** eligible products, time limit, unused-product conditions and return shipping responsibility.
7. **Warranty:** coverage for brake products and each accessory category.
8. **Fitment responsibility:** customer confirmation process and what happens when a selected part does not fit.
9. **Customer support:** official phone, WhatsApp, email, business hours and response targets.
10. **Administration:** staff members who may manage products, stock, prices and orders.

## Production gates

- No generated accessory may be published without owner verification.
- No product may display `In stock` without a stock source or an approved manual status.
- No unverified price may be displayed.
- No compatibility claim may be published without catalogue or FIAA confirmation.
- No product image area may claim a photograph exists until a genuine image is supplied.
- Checkout cannot launch until delivery, payment, notification, cancellation and refund behavior are defined and tested.

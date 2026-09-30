const root = document.querySelector(".order-status-page");
const panel = document.querySelector("#orderStatus");
const orderNumber = root?.dataset.orderNumber;
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const money = value => new Intl.NumberFormat("en-NG", { style: "currency", currency: value.currency }).format(value.amountMinor / 100);
const statusText = value => ({ pending_payment: "Payment pending", paid: "Paid", processing: "Processing", ready_for_pickup: "Ready for pickup", shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled", refunded: "Refunded" })[value] || value;

async function loadOrder() {
  try {
    const response = await fetch(`/v1/orders/${encodeURIComponent(orderNumber)}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
    const order = await response.json();
    if (!response.ok) throw new Error(order.detail || "Order access failed.");
    panel.innerHTML = `<div class="order-status-heading"><div><small>Current status</small><h2>${escapeHtml(statusText(order.status))}</h2></div><strong>${money(order.total)}</strong></div><div class="order-lines">${order.items.map(item => `<div><span>${escapeHtml(item.name)} <small>× ${item.quantity}</small></span><strong>${money(item.lineTotal)}</strong></div>`).join("")}</div><dl class="order-totals"><div><dt>Subtotal</dt><dd>${money(order.subtotal)}</dd></div><div><dt>Delivery</dt><dd>${money(order.delivery)}</dd></div><div><dt>Total</dt><dd>${money(order.total)}</dd></div></dl><p>Placed ${new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(order.placedAt))}</p>`;
  } catch (error) {
    panel.innerHTML = `<h2>We could not open this order</h2><p>${escapeHtml(error.message)}</p><a class="button button-secondary" href="/#support">Contact FIAA</a>`;
  }
}

loadOrder();

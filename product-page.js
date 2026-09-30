const button = document.querySelector(".product-page-add");
const status = document.querySelector(".product-page-status");

async function request(path, options = {}) {
  const response = await fetch(`/v1${path}`, { credentials: "include", headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) }, ...options });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.detail || "The request could not be completed.");
  return body;
}

async function getCart() {
  const id = localStorage.getItem("fiaaCartId");
  if (id) {
    try { return await request(`/carts/${encodeURIComponent(id)}`); }
    catch { localStorage.removeItem("fiaaCartId"); }
  }
  const cart = await request("/carts", { method: "POST" });
  localStorage.setItem("fiaaCartId", cart.id);
  return cart;
}

button?.addEventListener("click", async () => {
  button.disabled = true; status.textContent = "Adding to cart…";
  try {
    const cart = await getCart();
    const line = cart.items.find(item => item.sku === button.dataset.sku);
    await request(`/carts/${cart.id}/items/${encodeURIComponent(button.dataset.sku)}`, { method: "PUT", body: JSON.stringify({ quantity: (line?.quantity || 0) + 1 }) });
    status.textContent = "Added to cart. Return to the catalogue to review your cart.";
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});

const BACKEND_URL = 'https://api.yourdomain.com'; // REPLACE WITH YOUR PERSISTENT CUSTOM HOSTNAME

document.addEventListener('DOMContentLoaded', () => {
    const productCards = document.querySelectorAll('.product-card');
    
    // UI Elements
    const cartBar = document.getElementById('cart-bar'), cartTotalItems = document.getElementById('cart-total-items'),
          cartTotalPrice = document.getElementById('cart-total-price'), btnViewCart = document.getElementById('btn-view-cart'),
          cartPanelOverlay = document.getElementById('cart-panel-overlay'), btnCloseCart = document.getElementById('btn-close-cart'),
          cartItemsList = document.getElementById('cart-items-list'), panelTotalPrice = document.getElementById('panel-total-price'),
          btnTotal = document.getElementById('btn-total'), btnCheckout = document.getElementById('btn-checkout'),
          toast = document.getElementById('toast'), overlay = document.getElementById('state-overlay'),
          overlayIcon = document.getElementById('overlay-icon'), overlayTitle = document.getElementById('overlay-title'),
          overlaySubtitle = document.getElementById('overlay-subtitle');

    let cart = {}, isProcessing = false;

    const showToast = (msg) => {
        toast.textContent = msg; toast.classList.remove('hidden', 'fade-out');
        setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.classList.add('hidden'), 300); }, 3000);
    };

    const updateCartUI = () => {
        let totalQty = 0, totalPrice = 0, cartArray = [];
        Object.keys(cart).forEach(id => {
            if (cart[id].qty > 0) {
                totalQty += cart[id].qty; totalPrice += cart[id].price * cart[id].qty;
                cartArray.push({ item_id: id, quantity: cart[id].qty });
            }
        });
        if (totalQty === 0) { cartBar.classList.add('hidden'); cartPanelOverlay.classList.add('hidden'); }
        else { cartBar.classList.remove('hidden'); cartTotalItems.textContent = `${totalQty} Items`; cartTotalPrice.textContent = `₹${totalPrice}`; }
        btnTotal.textContent = `₹${totalPrice}`; panelTotalPrice.textContent = `₹${totalPrice}`;
        renderCartPanel(); return cartArray;
    };

    const renderCartPanel = () => {
        cartItemsList.innerHTML = '';
        Object.keys(cart).forEach(id => {
            if (cart[id].qty > 0) {
                const el = document.createElement('div'); el.className = 'panel-cart-item';
                el.innerHTML = `<div class="panel-cart-item-info"><div class="panel-cart-item-icon">${cart[id].icon}</div><div>${cart[id].name}</div></div>
                                <div class="panel-qty-control"><button onclick="adjust('${id}', -1)">−</button><span>${cart[id].qty}</span><button onclick="adjust('${id}', 1)">+</button></div>`;
                cartItemsList.appendChild(el);
            }
        });
    };

    window.adjust = (id, delta) => {
        if (cart[id]) { cart[id].qty = Math.max(0, Math.min(4, cart[id].qty + delta)); if (cart[id].qty === 0) delete cart[id]; updateCartUI(); updateGrid(); }
    };

    const updateGrid = () => {
        productCards.forEach(c => {
            const id = c.dataset.id, qty = cart[id] ? cart[id].qty : 0;
            c.querySelector('.add-btn').classList.toggle('hidden', qty > 0);
            c.querySelector('.qty-control').classList.toggle('hidden', qty === 0);
            if (qty > 0) c.querySelector('.qty-text').textContent = qty;
        });
    };

    const setOverlay = (state, title = '', sub = '') => {
        if (state === 'hidden') { overlay.classList.add('hidden'); return; }
        overlay.classList.remove('hidden'); overlayTitle.textContent = title; overlaySubtitle.textContent = sub;
        overlayIcon.innerHTML = state === 'loading' ? '<div class="loader"></div>' : (state === 'success' ? '✅' : '❌');
    };

    // Robust fetch with retry and timeout
    async function secureFetch(url, body, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000);
                const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
                clearTimeout(timeoutId);
                return res;
            } catch (e) {
                if (i === retries - 1) throw e;
                await new Promise(r => setTimeout(r, 2000 * (i + 1))); // Exponential backoff
            }
        }
    }

    productCards.forEach(card => {
        card.querySelector('.add-btn').onclick = () => {
            const d = card.dataset; cart[d.id] = { name: d.name, price: parseInt(d.price), icon: d.icon, qty: 1 };
            updateCartUI(); updateGrid();
        };
    });

    btnCheckout.onclick = async () => {
        const items = updateCartUI();
        if (isProcessing || !items.length) return;
        if (!document.getElementById('terms-checkbox').checked) return alert("Agree to terms");

        isProcessing = true; btnCheckout.disabled = true; cartPanelOverlay.classList.add('hidden');
        setOverlay('loading', 'Initiating...', 'Talking to machine');

        try {
            const res = await secureFetch(`${BACKEND_URL}/api/create_order`, { cart: items });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);

            setOverlay('hidden');
            const rzp = new Razorpay({
                key: data.key, amount: data.amount, order_id: data.order_id, name: "SmartVending",
                handler: async (resp) => {
                    setOverlay('loading', 'Payment Success', 'Verification in progress...');
                    let stage = 'verifying';
                    
                    const poller = setInterval(() => {
                        if (stage === 'verifying') setOverlay('loading', 'Still verifying...', 'Machine is responding');
                    }, 8000);

                    try {
                        const vRes = await secureFetch(`${BACKEND_URL}/api/verify_payment`, {
                            ...resp, cart: items
                        }, 5); // More retries for verification
                        const vData = await vRes.json();
                        clearInterval(poller);

                        if (vRes.ok && vData.status === 'success') {
                            setOverlay('success', 'Enjoy!', 'Dispensing complete.');
                            setTimeout(() => { location.reload(); }, 3000);
                        } else throw new Error(vData.message);
                    } catch (e) {
                        clearInterval(poller);
                        setOverlay('error', 'Dispense Error', e.message);
                        setTimeout(() => { isProcessing = false; btnCheckout.disabled = false; setOverlay('hidden'); }, 5000);
                    }
                },
                modal: { ondismiss: () => { isProcessing = false; btnCheckout.disabled = false; setOverlay('hidden'); } }
            });
            rzp.open();
        } catch (e) {
            setOverlay('error', 'Connection Error', e.message);
            setTimeout(() => { isProcessing = false; btnCheckout.disabled = false; setOverlay('hidden'); }, 4000);
        }
    };
});

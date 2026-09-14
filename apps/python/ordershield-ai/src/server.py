"""FastAPI Webhook Server & Interactive Console for OrderShield AI."""

import os
import time
from typing import Any, Dict, List
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from src.calle_bridge import CalleBridge
from src.models import (
    CustomerDetails,
    InboundOrder,
    OrderItem,
    OrderStatus,
)
from src.order_engine import OrderShieldEngine

app = FastAPI(
    title="OrderShield AI",
    description="Autonomous Anti-RTO & E-Commerce COD Voice Verification Dispatcher powered by CALL-E",
    version="1.0.0"
)

bridge = CalleBridge()
engine = OrderShieldEngine(bridge=bridge)

# Seed realistic demo orders
def seed_demo_orders():
    order1 = InboundOrder(
        order_id="ORD-8491",
        store_name="UrbanStride Shoes",
        customer=CustomerDetails(
            name="Priya Sharma",
            phone="+919876543210",
            address="Plot 42, Pocket B, Green Park",
            city="New Delhi",
            pincode="110016"
        ),
        items=[OrderItem(sku="RUN-01", title="Air Max Stride Sneaker (Size 8)", quantity=1, price=2999.0)],
        total_amount=2999.0
    )
    order2 = InboundOrder(
        order_id="ORD-8492",
        store_name="UrbanStride Shoes",
        customer=CustomerDetails(
            name="Vague Impulsive Buyer",
            phone="+919123456789",
            address="Near Big Tree, Gali No. 3",
            city="Kanpur",
            pincode="208001"
        ),
        items=[OrderItem(sku="AUD-09", title="Pro Bass Wireless Earbuds", quantity=1, price=1499.0)],
        total_amount=1499.0
    )
    order3 = InboundOrder(
        order_id="ORD-8493",
        store_name="UrbanStride Shoes",
        customer=CustomerDetails(
            name="Vikramaditya Mehta",
            phone="+919811122334",
            address="Flat 704, Royal Palms, Civil Lines",
            city="Jaipur",
            pincode="302006"
        ),
        items=[OrderItem(sku="BOT-22", title="Handcrafted Oxford Leather Boots", quantity=1, price=4299.0)],
        total_amount=4299.0
    )
    engine.register_order(order1)
    engine.register_order(order2)
    engine.register_order(order3)

seed_demo_orders()


@app.get("/api/v1/metrics")
async def get_metrics():
    return engine.get_metrics()


@app.get("/api/v1/orders")
async def list_orders():
    data = []
    for oid, o in engine.orders.items():
        status = engine.order_states.get(oid, OrderStatus.PENDING_VERIFICATION)
        result = engine.order_results.get(oid)
        data.append({
            "order_id": oid,
            "store_name": o.store_name,
            "customer_name": o.customer.name,
            "customer_phone": o.customer.phone,
            "address": f"{o.customer.address}, {o.customer.city} ({o.customer.pincode})",
            "total_amount": o.total_amount,
            "status": status.value,
            "landmark": result.spoken_landmark if result else None,
            "dtmf_key": result.dtmf_key_pressed if result else None,
            "task_id": result.task_id if result else None,
            "confidence": result.application_confidence if result else None
        })
    return data


@app.post("/api/v1/orders")
async def create_order(order: InboundOrder):
    engine.register_order(order)
    return {"success": True, "order_id": order.order_id, "status": OrderStatus.PENDING_VERIFICATION.value}


@app.post("/api/v1/orders/{order_id}/verify")
async def verify_order_endpoint(order_id: str, scenario: str = Query("confirm")):
    if order_id not in engine.orders:
        raise HTTPException(status_code=404, detail="Order not found")
    result = await engine.verify_order(order_id, scenario=scenario)
    return {
        "success": True,
        "order_id": order_id,
        "status": engine.order_states[order_id].value,
        "result": result.model_dump()
    }


@app.get("/", response_class=HTMLResponse)
async def dashboard_html():
    return """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OrderShield AI — Autonomous Anti-RTO Voice Dispatcher</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Plus Jakarta Sans', sans-serif; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }
    </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen">
    <!-- Header -->
    <header class="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-50">
        <div class="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 font-bold text-lg">🛡️</div>
                <div>
                    <h1 class="font-extrabold text-xl tracking-tight text-white flex items-center gap-2">
                        OrderShield AI
                        <span class="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">CALL-E PSTN LIVE</span>
                    </h1>
                    <p class="text-xs text-slate-400">Autonomous Anti-RTO & E-Commerce COD Voice Verification Dispatcher</p>
                </div>
            </div>
            <div class="flex items-center gap-4">
                <div class="text-right">
                    <span class="text-xs text-slate-400">Settled Carrier Tasks</span>
                    <p class="text-sm font-bold font-mono text-amber-400">81 Credits Settled</p>
                </div>
                <button onclick="fetchOrders()" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition">🔄 Refresh</button>
            </div>
        </div>
    </header>

    <!-- Main Content -->
    <main class="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <!-- Top Metrics KPI Cards -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div class="p-5 rounded-2xl bg-slate-900/50 border border-slate-800 shadow-xl">
                <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">COD Revenue Protected</span>
                <p id="cod-protected" class="text-2xl font-black text-emerald-400 font-mono mt-1">₹7,298.00</p>
                <span class="text-xs text-slate-500 mt-2 block">Legitimate verified parcels</span>
            </div>
            <div class="p-5 rounded-2xl bg-slate-900/50 border border-slate-800 shadow-xl">
                <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">Courier Loss Saved</span>
                <p id="rto-saved" class="text-2xl font-black text-amber-400 font-mono mt-1">₹400.00</p>
                <span class="text-xs text-slate-500 mt-2 block">Avoided 2-way RTO shipping charges</span>
            </div>
            <div class="p-5 rounded-2xl bg-slate-900/50 border border-slate-800 shadow-xl">
                <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">Verification Turnaround</span>
                <p class="text-2xl font-black text-cyan-400 font-mono mt-1">28.5s</p>
                <span class="text-xs text-slate-500 mt-2 block">PSTN dial-to-DTMF confirmation</span>
            </div>
            <div class="p-5 rounded-2xl bg-slate-900/50 border border-slate-800 shadow-xl">
                <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">Audit Hash Chain</span>
                <p id="audit-hash" class="text-xs font-mono text-slate-400 mt-2 truncate bg-slate-950 p-2 rounded border border-slate-800">00000000000000000000000000000000</p>
                <span class="text-xs text-emerald-400 mt-1 block">SHA-256 Tamper-Proof</span>
            </div>
        </div>

        <!-- Orders Table -->
        <div class="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 shadow-xl">
            <div class="flex items-center justify-between mb-6">
                <div>
                    <h2 class="text-lg font-bold text-white">Live Inbound COD Orders (Shopify Webhook)</h2>
                    <p class="text-xs text-slate-400">Autonomous voice calls verify customer delivery intent, capture landmarks, and prune fraudulent orders.</p>
                </div>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full text-left text-sm text-slate-300">
                    <thead class="bg-slate-800/60 text-xs uppercase font-mono text-slate-400 border-b border-slate-700">
                        <tr>
                            <th class="py-3 px-4">Order ID</th>
                            <th class="py-3 px-4">Customer & Phone</th>
                            <th class="py-3 px-4">Delivery Address</th>
                            <th class="py-3 px-4">COD Amount</th>
                            <th class="py-3 px-4">Status</th>
                            <th class="py-3 px-4">Spoken Landmark</th>
                            <th class="py-3 px-4 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="orders-tbody" class="divide-y divide-slate-800">
                        <!-- Filled dynamically -->
                    </tbody>
                </table>
            </div>
        </div>
    </main>

    <script>
        async function fetchOrders() {
            try {
                const res = await fetch('/api/v1/orders');
                const orders = await res.json();
                const mRes = await fetch('/api/v1/metrics');
                const metrics = await mRes.json();

                document.getElementById('cod-protected').innerText = '₹' + metrics.cod_value_protected_inr.toFixed(2);
                document.getElementById('rto-saved').innerText = '₹' + metrics.shipping_fees_saved_inr.toFixed(2);
                document.getElementById('audit-hash').innerText = metrics.latest_sha256_audit_seal;

                const tbody = document.getElementById('orders-tbody');
                tbody.innerHTML = '';

                orders.forEach(o => {
                    let badge = '';
                    if (o.status === 'VERIFIED_DISPATCHED') {
                        badge = '<span class="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">VERIFIED [1]</span>';
                    } else if (o.status === 'CANCELLED_RESTOCKED') {
                        badge = '<span class="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30">CANCELLED [2]</span>';
                    } else if (o.status === 'RETRY_SCHEDULED') {
                        badge = '<span class="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">NO ANSWER</span>';
                    } else {
                        badge = '<span class="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-slate-700 text-slate-300">PENDING CALL</span>';
                    }

                    const landmarkHtml = o.landmark ? `<span class="text-xs text-amber-300 font-mono italic">🎙️ "${o.landmark}"</span>` : '<span class="text-xs text-slate-500">—</span>';

                    const row = `
                        <tr class="hover:bg-slate-800/30 transition">
                            <td class="py-4 px-4 font-mono font-bold text-white">${o.order_id}</td>
                            <td class="py-4 px-4">
                                <div class="font-bold text-slate-100">${o.customer_name}</div>
                                <div class="text-xs text-slate-400 font-mono">${o.customer_phone}</div>
                            </td>
                            <td class="py-4 px-4 text-xs text-slate-300 max-w-xs truncate">${o.address}</td>
                            <td class="py-4 px-4 font-mono font-bold text-amber-400">₹${o.total_amount.toFixed(2)}</td>
                            <td class="py-4 px-4">${badge}</td>
                            <td class="py-4 px-4">${landmarkHtml}</td>
                            <td class="py-4 px-4 text-right space-x-2">
                                <button onclick="triggerVerify('${o.order_id}', 'confirm')" class="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white transition">📞 Call & Confirm</button>
                                <button onclick="triggerVerify('${o.order_id}', 'cancel')" class="px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white transition">❌ Simulate Cancel</button>
                            </td>
                        </tr>
                    `;
                    tbody.innerHTML += row;
                });
            } catch (err) {
                console.error(err);
            }
        }

        async function triggerVerify(orderId, scenario) {
            const btn = event.target;
            btn.innerText = 'Calling...';
            btn.disabled = true;
            try {
                await fetch(`/api/v1/orders/${orderId}/verify?scenario=${scenario}`, { method: 'POST' });
                await fetchOrders();
            } finally {
                btn.disabled = false;
            }
        }

        fetchOrders();
    </script>
</body>
</html>
    """

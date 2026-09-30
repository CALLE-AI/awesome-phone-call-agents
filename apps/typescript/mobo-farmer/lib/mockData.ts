export const mockStats = {
  waterReserve: { current: 2450, total: 3000 },
  activeCrops: { count: 4, area: 12.5 },
  callsAutomated: { count: 23, hoursSaved: 4.2 },
  pendingTasks: 3
};

export const mockCrops = [
  { id: 1, name: "Tomatoes", emoji: "🍅", details: "Roma VF • 2.5ha", waterPerDay: 5, remainingWater: 30, status: "Healthy", planted: "2024-12-15" },
  { id: 2, name: "Maize", emoji: "🌽", details: "L33 White • 6ha", waterPerDay: 8, remainingWater: 45, status: "Needs water", planted: "2024-11-20" },
  { id: 3, name: "Sunflowers", emoji: "🌻", details: "PAN 7080 • 3ha", waterPerDay: 3, remainingWater: 60, status: "Healthy", planted: "2024-12-01" },
  { id: 4, name: "Cabbage", emoji: "🥬", details: "Star 3301 • 1ha", waterPerDay: 4, remainingWater: 25, status: "Attention", planted: "2024-12-10" }
];

export const mockWaterManagement = {
  reservoirLevel: 82, // 2450/3000
  soilMoisture: 68,
  rainfall: [
    { day: "Mon", amount: 2 },
    { day: "Tue", amount: 2 },
    { day: "Wed", amount: 15 },
    { day: "Thu", amount: 5 },
    { day: "Fri", amount: 10 },
    { day: "Sat", amount: 1 },
    { day: "Sun", amount: 1 }
  ],
  recommendation: "Reduce tomato irrigation by 15% - rain expected Wed. Save ~8L. Soil moisture optimal for maize."
};

export const mockActiveCalls = [
  { id: 101, type: "Calling Afgri Bothaville...", target: "Check Input Stock", timeAgo: "2m ago" },
  { id: 102, type: "Calling Joburg Market...", target: "Find Buyer / Market Price", timeAgo: "5m ago" }
];

export const mockRecentResults = [
  {
    id: 201,
    query: "L33 Maize Seed - Afgri",
    result: "R875/bag, 60 in stock, delivery Wed",
    timeAgo: "1h ago"
  },
  {
    id: 202,
    query: "Vet Service - Bothaville Dierekliniek",
    result: "Dr. Van Rensburg available Thu 09:00, R450 callout",
    timeAgo: "3h ago"
  },
  {
    id: 203,
    query: "Water Allocation - Dept. Water",
    result: "Quota confirmed: 12,000L/month until March",
    timeAgo: "Yesterday"
  }
];

export const mockCallHistory = [
  {
    id: 301,
    date: "2025-01-14 09:22",
    agentType: "Stock Check",
    contact: "Afgri Bothaville",
    result: "Found • R875/bag",
    time: "2m 14s",
    cost: "R2.30",
    status: "completed"
  },
  {
    id: 302,
    date: "2025-01-14 08:15",
    agentType: "Market Price",
    contact: "Joburg Fresh Market",
    result: "Tomatoes R18/kg",
    time: "1m 42s",
    cost: "R1.80",
    status: "completed"
  },
  {
    id: 303,
    date: "2025-01-13 16:40",
    agentType: "Vet Service",
    contact: "Bothaville Dierekliniek",
    result: "Booked Thu 09:00",
    time: "3m 05s",
    cost: "R2.10",
    status: "completed"
  },
  {
    id: 304,
    date: "2025-01-13 11:20",
    agentType: "Transport",
    contact: "Free State Logistics",
    result: "Quote R1,200",
    time: "2m 31s",
    cost: "R1.95",
    status: "completed"
  },
  {
    id: 305,
    date: "2025-01-12 14:05",
    agentType: "Water Allocation",
    contact: "Dept. Water Affairs",
    result: "Quota confirmed",
    time: "4m 12s",
    cost: "R2.50",
    status: "completed"
  }
];

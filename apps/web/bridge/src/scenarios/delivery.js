function createDeliveryException() {
  return {
    id: `BR-${Date.now()}`,
    type: "delivery_exception",
    title: "Delayed Delivery #SHP-1001",
    goal: "Resolve a delayed shipment and complete delivery today.",
    currentNeed: "driver incident report",
    constraints: {
      latestDeliveryTime: "18:00",
      maxExtraCost: 2000
    },
    participants: [
      {
        id: "arjun",
        role: "Driver"
      },
      {
        id: "amit",
        role: "Warehouse Manager"
      },
      {
        id: "priya",
        role: "Operations Head"
      },
      {
        id: "rahul",
        role: "Customer"
      }
    ]
  };
}

module.exports = {
  createDeliveryException
};
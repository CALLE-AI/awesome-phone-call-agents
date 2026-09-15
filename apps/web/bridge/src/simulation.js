function simulateCallResult({ personId, task }) {
  const mapping = {
    arjun: {
      status: 'COMPLETED',
      personId: 'arjun',
      personName: 'Arjun',
      role: 'Driver',
      phone: '+91******0878',
      durationSeconds: 42,
      sentiment: 'urgent_cooperative',
      outcome: 'vehicle_problem_confirmed',
      dialogue: [
        { speaker: 'CALL-E (BRIDGE AI)', text: 'Hello Arjun, this is BRIDGE calling on behalf of QuickMove Logistics regarding Shipment #SHP-1001. Are you safe, and what is your current vehicle status?' },
        { speaker: 'Arjun (Driver)', text: 'Hi, yes I am pulled over safely on NH-48. Engine overheating alarm went off. Radiator hose is leaking. The vehicle cannot continue its route.' },
        { speaker: 'CALL-E (BRIDGE AI)', text: 'Understood. What is the estimated recovery time for the vehicle?' },
        { speaker: 'Arjun (Driver)', text: 'Tow truck and mechanic need at least 90 minutes. The parcels are intact, but we need a replacement van from the warehouse to meet today\'s delivery.' },
        { speaker: 'CALL-E (BRIDGE AI)', text: 'Thank you Arjun. BRIDGE is contacting the warehouse manager immediately to dispatch a replacement vehicle.' }
      ],
      extracted: {
        driverSafe: true,
        vehicleCondition: 'unusable',
        issue: 'Radiator hose leak / engine overheat',
        location: 'NH-48 Mile Marker 14',
        eta: '90 minutes',
        requiresTransfer: true
      },
      summary: 'Driver confirmed the vehicle is stalled due to a radiator leak. Parcels are secure, but recovery takes 90+ minutes. Replacement vehicle needed immediately.',
      transcript: 'CALL-E: Hello Arjun, this is BRIDGE regarding Shipment #SHP-1001. What is your vehicle status?\nArjun: Engine overheating, radiator hose leaking. Vehicle cannot continue.\nCALL-E: What is the recovery time?\nArjun: At least 90 minutes. Parcels are safe, but need replacement van from warehouse.\nCALL-E: Thank you, contacting warehouse now.'
    },
    amit: {
      status: 'COMPLETED',
      personId: 'amit',
      personName: 'Amit',
      role: 'Warehouse Manager',
      phone: '+91******1432',
      durationSeconds: 58,
      sentiment: 'efficient_collaborative',
      outcome: 'replacement_available',
      dialogue: [
        { speaker: 'CALL-E (BRIDGE AI)', text: 'Hello Amit, this is BRIDGE from QuickMove Logistics. Van #4 stalled on NH-48 with active shipment #SHP-1001. Do you have a replacement vehicle available for immediate dispatch?' },
        { speaker: 'Amit (Warehouse Manager)', text: 'Yes, I just checked the bay. We have Van #9 parked and ready. Driver Vikram is on standby.' },
        { speaker: 'CALL-E (BRIDGE AI)', text: 'What is the earliest departure time and are there any incremental costs involved?' },
        { speaker: 'Amit (Warehouse Manager)', text: 'He can depart by 16:30. Since it is an emergency off-schedule dispatch with an on-call driver, it incurs a ₹1,500 priority fee.' },
        { speaker: 'CALL-E (BRIDGE AI)', text: 'Noted: ₹1,500 emergency dispatch fee, ready at 16:30. Routing to Operations for approval.' }
      ],
      extracted: {
        replacementAvailable: true,
        vehicleId: 'Van #9 (Reserve)',
        dispatchTime: '16:30',
        extraCost: 1500,
        currency: 'INR',
        assignedDriver: 'Vikram'
      },
      summary: 'Warehouse confirmed replacement Van #9 is available to roll at 16:30. An emergency dispatch cost of ₹1,500 is required.',
      transcript: 'CALL-E: Hello Amit, need replacement vehicle for stalled Van #4 carrying #SHP-1001.\nAmit: Van #9 is ready. Can depart by 16:30. Incurs ₹1,500 on-call dispatch fee.\nCALL-E: Recorded ₹1,500 fee, dispatch 16:30. Routing for approval.'
    },
    priya: {
      status: 'COMPLETED',
      personId: 'priya',
      personName: 'Priya',
      role: 'Operations Head',
      phone: '+91******9090',
      durationSeconds: 36,
      sentiment: 'decisive',
      outcome: 'approval_granted',
      dialogue: [
        { speaker: 'CALL-E (BRIDGE AI)', text: 'Hello Priya, BRIDGE AI calling. Delayed delivery #SHP-1001 requires ₹1,500 extra dispatch expense for replacement Van #9 to meet SLA. Your policy limit is ₹2,000. Do you approve?' },
        { speaker: 'Priya (Operations Head)', text: 'Yes, I approve. ₹1,500 is well within my ₹2,000 discretionary limit. Please authorize Amit to dispatch immediately and confirm with the customer.' },
        { speaker: 'CALL-E (BRIDGE AI)', text: 'Approval recorded for ₹1,500. Authorization code OP-8821. Contacting customer next.' }
      ],
      extracted: {
        approved: true,
        approvedAmount: 1500,
        approvalCode: 'OP-8821',
        costLimit: 2000,
        remainingBudget: 500,
        authorizedAction: 'immediate_dispatch'
      },
      summary: 'Operations Head approved the ₹1,500 replacement dispatch fee within her ₹2,000 limit. Authorized immediate departure.',
      transcript: 'CALL-E: Priya, requesting ₹1,500 approval for replacement dispatch on #SHP-1001.\nPriya: Approved. It is within my ₹2,000 authority. Release the van and notify the customer.\nCALL-E: Authorization OP-8821 recorded.'
    },
    rahul: {
      status: 'COMPLETED',
      personId: 'rahul',
      personName: 'Rahul',
      role: 'Customer',
      phone: '+91******2211',
      durationSeconds: 48,
      sentiment: 'satisfied_reassured',
      outcome: 'delivery_confirmed',
      dialogue: [
        { speaker: 'CALL-E (BRIDGE AI)', text: 'Hello Mr. Rahul, this is BRIDGE coordinating your QuickMove delivery #SHP-1001. We encountered a minor transport delay but have dispatched a dedicated replacement vehicle. Your revised arrival time is 17:00 today. Does that work for you?' },
        { speaker: 'Rahul (Customer)', text: 'Thanks for proactively calling. 17:00 is completely fine. I will be home until 18:30 anyway. Will I need to sign?' },
        { speaker: 'CALL-E (BRIDGE AI)', text: 'Yes, digital signature on delivery. The driver will arrive at 17:00. Thank you for your flexibility!' },
        { speaker: 'Rahul (Customer)', text: 'Great, thanks for keeping me updated!' }
      ],
      extracted: {
        confirmed: true,
        agreedETA: '17:00',
        customerAvailableUntil: '18:30',
        signatureRequired: true,
        customerSatisfaction: 'high'
      },
      summary: 'Customer appreciated proactive communication and happily accepted revised 17:00 delivery window. Task fully resolved.',
      transcript: 'CALL-E: Hello Mr. Rahul, replacement van dispatched for #SHP-1001. Revised ETA is 17:00 today. Does that work?\nRahul: Yes, 17:00 is fine, I will be home. Thanks for calling proactively.\nCALL-E: Confirmed arrival 17:00.'
    }
  };

  const fallback = {
    status: 'COMPLETED',
    personId,
    durationSeconds: 30,
    sentiment: 'neutral',
    outcome: 'information_received',
    dialogue: [
      { speaker: 'CALL-E (BRIDGE AI)', text: `Hello, BRIDGE automated assistant calling to coordinate task "${task.goal || 'General operation'}".` },
      { speaker: personId, text: 'I received the request and have provided the necessary operational data.' },
      { speaker: 'CALL-E (BRIDGE AI)', text: 'Thank you. The response has been logged and the workflow will proceed.' }
    ],
    extracted: {
      actionCompleted: true,
      timestamp: new Date().toISOString()
    },
    summary: `Simulated participant ${personId} provided required input for "${task.currentNeed || 'general coordination'}".`,
    transcript: `CALL-E: Assistant calling regarding ${task.goal}.\n${personId}: Input confirmed and logged.\nCALL-E: Thank you.`
  };

  return mapping[personId] || fallback;
}

module.exports = {
  simulateCallResult
};

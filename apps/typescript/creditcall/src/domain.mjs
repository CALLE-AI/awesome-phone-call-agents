export function calculateException(packet) {
  if (!packet.recordsAreFictional) {
    throw new Error("The included workflow is limited to fictional demo records.");
  }

  const unitDifference = packet.invoiceUnitPrice - packet.orderedUnitPrice;
  const totalDifference = unitDifference * packet.quantity;

  if (unitDifference <= 0 || totalDifference <= 0) {
    throw new Error("The packet does not contain a positive price exception.");
  }

  return {
    ...packet,
    unitDifference,
    totalDifference,
  };
}

export function validatePhone(phone) {
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new Error("Use an E.164 phone number, such as +14165550123.");
  }
  return phone;
}

export function buildCallGoal(packet, { authorizedBy, recipientConsent }) {
  if (!authorizedBy) {
    throw new Error("A named person must approve the call plan.");
  }
  if (!recipientConsent) {
    throw new Error("The test recipient must consent before any call is planned.");
  }

  const exception = calculateException(packet);
  const money = new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: exception.currency,
  });

  return [
    "This is a disclosed automated test call from CreditCall.",
    "The person answering has agreed to receive this test call.",
    "If an automated call-screening system answers, give only the name CreditCall and say this is a consented fictional invoice demo.",
    "Do not treat call-screening responses as recipient approval or as a channel preference.",
    "When a person joins after screening, repeat the automation disclosure, ask whether they are ready, and wait for their answer before continuing.",
    "Do not claim to represent the supplier, CDW Canada, or any real business.",
    `Refer only to fictional demo packet ${exception.packetId} and fictional invoice ${exception.invoiceId}.`,
    `Explain that ${exception.quantity} ${exception.item} were ordered at ${money.format(exception.orderedUnitPrice)} each and invoiced at ${money.format(exception.invoiceUnitPrice)} each.`,
    `The verified demo exception is ${money.format(exception.totalDifference)}.`,
    "Ask whether the recipient would prefer a credit request by email or through a vendor portal.",
    "Do not request payment details, account credentials, personal information, or a commitment.",
    "If the recipient is confused or asks to stop, apologize and end the call.",
    `Record that the plan was approved by ${authorizedBy}.`,
  ].join(" ");
}

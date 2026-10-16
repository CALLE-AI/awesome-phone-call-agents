import type {
  DispatchRequest,
  ValidationError,
  ValidationResult,
} from "./types";

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const DISPATCH_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDispatchRequest(value: unknown): value is DispatchRequest {
  if (!isRecord(value) || !isRecord(value.workOrder) || !Array.isArray(value.vendors)) {
    return false;
  }

  const workOrder = value.workOrder;
  const validWorkOrder =
    typeof workOrder.title === "string" &&
    typeof workOrder.issue === "string" &&
    typeof workOrder.property === "string" &&
    typeof workOrder.location === "string" &&
    ["routine", "soon", "urgent"].includes(String(workOrder.urgency)) &&
    typeof workOrder.disclosure === "string" &&
    workOrder.maximumAuthorizedAction === "information_only";

  const validVendors = value.vendors.every(
    (vendor) =>
      isRecord(vendor) &&
      typeof vendor.id === "string" &&
      typeof vendor.name === "string" &&
      typeof vendor.trade === "string" &&
      typeof vendor.phone === "string" &&
      typeof vendor.authorized === "boolean" &&
      typeof vendor.selected === "boolean",
  );

  return (
    validWorkOrder &&
    validVendors &&
    typeof value.confirmedRealCalls === "boolean" &&
    typeof value.dispatchId === "string"
  );
}

function required(
  value: string,
  field: string,
  label: string,
  errors: ValidationError[],
  minimum = 2,
) {
  if (value.trim().length < minimum) {
    errors.push({ field, message: `${label} is required.` });
  }
}

export function validateDispatchRequest(request: DispatchRequest): ValidationResult {
  const errors: ValidationError[] = [];

  required(request.workOrder.title, "workOrder.title", "Work-order title", errors, 4);
  required(request.workOrder.issue, "workOrder.issue", "Issue description", errors, 12);
  required(request.workOrder.property, "workOrder.property", "Property", errors);
  required(request.workOrder.location, "workOrder.location", "Location", errors);
  required(request.workOrder.disclosure, "workOrder.disclosure", "Disclosure budget", errors, 12);

  if (request.workOrder.maximumAuthorizedAction !== "information_only") {
    errors.push({
      field: "workOrder.maximumAuthorizedAction",
      message: "This release permits information gathering only.",
    });
  }

  const selected = request.vendors.filter((vendor) => vendor.selected);
  if (selected.length === 0) {
    errors.push({ field: "vendors", message: "Select at least one authorized vendor." });
  }
  if (selected.length > 5) {
    errors.push({ field: "vendors", message: "Select no more than five vendors per dispatch." });
  }

  request.vendors.forEach((vendor, index) => {
    if (!vendor.selected) return;

    required(vendor.name, `vendors.${index}.name`, "Vendor name", errors);
    required(vendor.trade, `vendors.${index}.trade`, "Vendor trade", errors);
    if (!E164_PATTERN.test(vendor.phone)) {
      errors.push({
        field: `vendors.${index}.phone`,
        message: "Use an E.164 phone number such as +14155550100.",
      });
    }
    if (!vendor.authorized) {
      errors.push({
        field: `vendors.${index}.authorized`,
        message: "Confirm that you are authorized to call this vendor.",
      });
    }
  });

  if (!request.confirmedRealCalls) {
    errors.push({
      field: "confirmedRealCalls",
      message: "Explicit confirmation is required before placing real calls.",
    });
  }

  if (!DISPATCH_ID_PATTERN.test(request.dispatchId)) {
    errors.push({
      field: "dispatchId",
      message: "Use the UUID created for this dispatch intent.",
    });
  }

  return errors.length === 0
    ? { valid: true, errors: [] }
    : { valid: false, errors };
}

const ACTIVE = [
  "MATCHING",
  "DRIVER_ASSIGNED",
  "DRIVER_EN_ROUTE",
  "DRIVER_ARRIVED",
  "OTP_VERIFIED",
  "IN_PROGRESS",
];
const transitions = {
  MATCHING: [
    "DRIVER_ASSIGNED",
    "CANCELLED_BY_CUSTOMER",
    "CANCELLED_BY_ADMIN",
    "NO_DRIVER_AVAILABLE",
  ],
  DRIVER_ASSIGNED: [
    "DRIVER_EN_ROUTE",
    "CANCELLED_BY_CUSTOMER",
    "CANCELLED_BY_ADMIN",
    "CANCELLED_BY_DRIVER",
  ],
  DRIVER_EN_ROUTE: [
    "DRIVER_ARRIVED",
    "CANCELLED_BY_CUSTOMER",
    "CANCELLED_BY_ADMIN",
    "CANCELLED_BY_DRIVER",
  ],
  DRIVER_ARRIVED: [
    "OTP_VERIFIED",
    "CANCELLED_BY_ADMIN",
    "CANCELLED_BY_CUSTOMER",
  ],
  OTP_VERIFIED: ["IN_PROGRESS"],
  IN_PROGRESS: ["COMPLETED"],
};
function canTransition(from, to) {
  return (transitions[from] || []).includes(to);
}
function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a nonnegative integer`);
  return value;
}
function quote({
  base = 5000,
  hourly = 15000,
  minimum = 20000,
  hours = 2,
  commissionBps = 1500,
}) {
  [base, hourly, minimum, commissionBps].forEach((v) => integer(v, "Pricing"));
  if (
    !Number.isInteger(hours) ||
    hours < 1 ||
    hours > 24 ||
    commissionBps > 10000
  )
    throw new Error("Invalid booking inputs");
  const total = Math.max(minimum, base + hourly * hours);
  const commission = Math.floor((total * commissionBps + 5000) / 10000);
  return { total, commission, earnings: total - commission };
}
function money(paise) {
  return `₹${(Number(paise || 0) / 100).toFixed(2)}`;
}
function validPhone(value) {
  return /^\+[1-9]\d{7,14}$/.test(value);
}
module.exports = { ACTIVE, canTransition, quote, money, validPhone };

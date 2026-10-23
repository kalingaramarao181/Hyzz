const test = require("node:test");
const assert = require("node:assert/strict");
const {
  quote,
  canTransition,
  validPhone,
  money,
} = require("../packages/domain.cjs");
test("disclosed two-hour fare and driver-only commission", () =>
  assert.deepEqual(quote({}), {
    total: 35000,
    commission: 5250,
    earnings: 29750,
  }));
test("minimum fare protects small booking and commission rounds once to paise", () =>
  assert.deepEqual(
    quote({
      base: 0,
      hourly: 101,
      minimum: 101,
      hours: 1,
      commissionBps: 1500,
    }),
    { total: 101, commission: 15, earnings: 86 },
  ));
test("100 percent and zero commission conserve money", () => {
  for (const bps of [0, 1, 1500, 10000]) {
    const q = quote({ base: 1, hourly: 12345, hours: 3, commissionBps: bps });
    assert.equal(q.total, q.earnings + q.commission);
  }
});
test("reject fractional duration, negative prices and invalid commission", () => {
  assert.throws(() => quote({ hours: 1.5 }));
  assert.throws(() => quote({ base: -1 }));
  assert.throws(() => quote({ commissionBps: 10001 }));
});
test("trip cannot skip arrival, restart completed booking or erase completed trip for payment failure", () => {
  assert.equal(canTransition("DRIVER_ASSIGNED", "IN_PROGRESS"), false);
  assert.equal(canTransition("COMPLETED", "IN_PROGRESS"), false);
  assert.equal(canTransition("COMPLETED", "PAYMENT_FAILED"), false);
  assert.equal(canTransition("DRIVER_ARRIVED", "IN_PROGRESS"), false);
  assert.equal(canTransition("DRIVER_ARRIVED", "OTP_VERIFIED"), true);
  assert.equal(canTransition("OTP_VERIFIED", "IN_PROGRESS"), true);
});
test("phone contacts require international format and currency preserves paise", () => {
  assert.equal(validPhone("+919876543210"), true);
  assert.equal(validPhone("9876543210"), false);
  assert.equal(money(101), "₹1.01");
});

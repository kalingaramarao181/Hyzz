import React, { useEffect, useState } from "react";
export default function DriverPayoutReview({
  db,
  rpc,
  run,
  apiURL,
  canManage,
}) {
  const [items, setItems] = useState([]),
    [revealed, setRevealed] = useState({});
  async function load() {
    setItems(await rpc("admin_driver_payouts"));
  }
  useEffect(() => {
    run(load);
  }, [run]);
  async function decide(p, status) {
    const reason = window.prompt("Review reason (at least 5 characters)");
    if (!reason) return;
    const reference =
      status === "paid"
        ? window.prompt("Actual external bank transfer reference")
        : null;
    if (status === "paid" && !reference) return;
    if (
      status === "paid" &&
      !window.confirm(
        "Confirm the money was already transferred outside Hyzz. This records the payment; it does not initiate a bank transfer.",
      )
    )
      return;
    await run(async () => {
      await rpc("admin_review_payout", {
        p_payout: p.id,
        p_status: status,
        p_reason: reason,
        p_reference: reference,
      });
      setRevealed({});
      await load();
    });
  }
  async function reveal(p) {
    await run(async () => {
      const {
        data: { session },
      } = await db.auth.getSession();
      const response = await fetch(
        apiURL + "/api/v1/bank/payout/" + p.id + "/reveal",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + session.access_token,
            "Content-Type": "application/json",
          },
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Bank access denied");
      setRevealed((old) => ({ ...old, [p.id]: data }));
    });
  }
  return (
    <>
      <section className="panel">
        <h2>Driver payout requests</h2>
        <p>
          Cash trip earnings remain with drivers. These requests pay platform
          credits owed by Hyzz. Review the destination and make the actual
          transfer through your bank before marking a request paid. Bank reveals
          are audited.
        </p>
        <button className="ghost" onClick={() => run(load)}>
          Refresh payout requests
        </button>
        {!items.length && <p>No requests yet.</p>}
        {items.map((p) => (
          <article
            key={p.id}
            style={{ borderBottom: "1px solid #E5E9E7", padding: "18px 0" }}
          >
            <h3>
              {p.full_name || p.driver_id} - INR{" "}
              {(p.amount_paise / 100).toFixed(2)}
            </h3>
            <p>
              {p.state} - {p.payee_name} - {p.ifsc} - account ending {p.last4}
            </p>
            <small>{p.id}</small>
            {p.review_note && <p>{p.review_note}</p>}
            {p.external_reference && (
              <p>External transfer: {p.external_reference}</p>
            )}
            {canManage && (
              <div className="actions">
                {!revealed[p.id] ? (
                  <button className="ghost" onClick={() => reveal(p)}>
                    Reveal payment destination
                  </button>
                ) : (
                  <>
                    <p>
                      Account: {revealed[p.id].account} - {revealed[p.id].name}{" "}
                      - {revealed[p.id].ifsc}
                    </p>
                    <button
                      className="ghost"
                      onClick={() =>
                        setRevealed((old) => ({ ...old, [p.id]: null }))
                      }
                    >
                      Hide bank details
                    </button>
                  </>
                )}
                {p.state === "pending" && (
                  <button onClick={() => decide(p, "approved")}>
                    Approve request
                  </button>
                )}
                {["pending", "approved"].includes(p.state) && (
                  <button
                    className="ghost"
                    onClick={() => decide(p, "rejected")}
                  >
                    Reject request
                  </button>
                )}
                {p.state === "approved" && (
                  <button onClick={() => decide(p, "paid")}>
                    Record external transfer
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </section>
      {canManage && (
        <section className="panel">
          <h2>Record credit owed to a driver</h2>
          <p>
            Use only for a reviewed incentive or adjustment actually owed by
            Hyzz. This creates payout credit, not cash trip earnings. References
            are unique and entries cannot be rewritten.
          </p>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              run(async () => {
                await rpc("admin_credit_driver", {
                  p_driver: f.get("driver"),
                  p_amount: Math.round(Number(f.get("amount")) * 100),
                  p_kind: f.get("kind"),
                  p_reference: f.get("reference"),
                  p_reason: f.get("reason"),
                });
                form.reset();
                await load();
              });
            }}
          >
            <label>
              Driver UUID
              <input name="driver" required />
            </label>
            <label>
              Amount (INR)
              <input
                name="amount"
                type="number"
                min="0.01"
                max="1000000"
                step="0.01"
                required
              />
            </label>
            <label>
              Credit type
              <select name="kind">
                <option value="incentive">Incentive</option>
                <option value="adjustment">Adjustment</option>
              </select>
            </label>
            <label>
              Unique reference
              <input name="reference" minLength={5} maxLength={100} required />
            </label>
            <label>
              Review reason
              <input name="reason" minLength={5} required />
            </label>
            <button>Record driver credit</button>
          </form>
        </section>
      )}
    </>
  );
}

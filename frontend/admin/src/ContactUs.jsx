import React, { useEffect, useState } from "react";
import { API_BASE_URL } from "./config/api";
export default function ContactUs() {
  const [open, setOpen] = useState(false),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [phone, setPhone] = useState("+917730020465");
  useEffect(() => {
    fetch(API_BASE_URL + "/api/v1/public/content")
      .then((r) => (r.ok ? r.json() : []))
      .then((items) => {
        const p = items.find((i) => i.key === "contact_phone");
        if (p) setPhone(p.body);
      })
      .catch(() => {});
  }, []);
  return (
    <div className="contact-login">
      <p>
        Need access or help? {phone && <a href={"tel:" + phone}>{phone}</a>}
      </p>
      <button className="ghost" onClick={() => setOpen(!open)}>
        {open ? "Close contact form" : "Contact the Hyzz team"}
      </button>
      {open && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setStatus("");
            const f = new FormData(e.currentTarget);
            try {
              const r = await fetch(API_BASE_URL + "/api/v1/public/contact", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: f.get("name"),
                  email: f.get("email"),
                  phone: null,
                  topic: "support",
                  message: f.get("message"),
                  consent: true,
                  website: "",
                }),
              });
              const result = await r.json();
              if (!r.ok)
                throw Error(result.message || "Could not submit enquiry.");
              setStatus(result.message);
            } catch (e) {
              setStatus(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Name
            <input name="name" required minLength={2} maxLength={100} />
          </label>
          <label>
            Reply email
            <input name="email" type="email" required />
          </label>
          <label>
            How can we help?
            <textarea name="message" required minLength={10} maxLength={2000} />
          </label>
          <label className="checkbox">
            <input type="checkbox" required />I agree Hyzz may use these details
            to respond.
          </label>
          <button disabled={busy}>{busy ? "Sending…" : "Send enquiry"}</button>
          <p role="status">{status}</p>
        </form>
      )}
    </div>
  );
}

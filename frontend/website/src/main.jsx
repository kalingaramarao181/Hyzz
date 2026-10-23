import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
const API = (
  import.meta.env.VITE_API_BASE_URL || "https://api.srtechcreators.in"
).replace(/\/$/, "");
const ADMIN =
  import.meta.env.VITE_ADMIN_URL || "https://hyzz.srtechcreators.in";
function App() {
  const [content, setContent] = useState([]),
    [releases, setReleases] = useState({}),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [sending, setSending] = useState(false),
    [policy, setPolicy] = useState(null);
  useEffect(() => {
    let active = true;
    fetch(API + "/api/v1/public/content")
      .then(async (r) => {
        if (!r.ok)
          throw Error(
            "Service information could not be refreshed. Please contact the team.",
          );
        return r.json();
      })
      .then((data) => {
        if (active) setContent(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    for (const audience of ["customer", "driver"])
      fetch(API + "/api/v1/releases/latest/" + audience)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (active) setReleases((p) => ({ ...p, [audience]: data }));
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const text = (key, fallback) =>
    content.find((i) => i.key === key)?.body ?? fallback;
  const phone = text("contact_phone", "+917730020465"),
    whatsapp = text("contact_whatsapp", phone),
    email = text("contact_email", "");
  async function contact(e) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    setSending(true);
    setStatus("");
    try {
      let p = String(f.get("phone") || "").replace(/[\s()-]/g, "");
      if (/^\d{10}$/.test(p)) p = "+91" + p;
      const r = await fetch(API + "/api/v1/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: f.get("name"),
          email: f.get("email"),
          phone: p || null,
          topic: f.get("topic"),
          message: f.get("message"),
          consent: f.get("consent") === "on",
          website: f.get("website"),
        }),
      });
      const result = await r.json();
      if (!r.ok)
        throw Error(result.message || "Your enquiry could not be sent.");
      setStatus(result.message);
      form.reset();
    } catch (e) {
      setStatus(e.message || "Please check your connection and retry.");
    } finally {
      setSending(false);
    }
  }
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header>
        <a className="brand" href="#">
          <img src="/hyzz-mark.svg" alt="" />
          hyzz<span>.</span>
        </a>
        <nav aria-label="Website navigation">
          <a href="#how">How it works</a>
          <a href="#partners">Drive with us</a>
          <a href="#downloads">Get the apps</a>
          <a href="#contact">Contact</a>
        </nav>
        <a className="staff" href={ADMIN}>
          Staff sign in ↗
        </a>
      </header>
      <main id="main">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">
              <span /> YOUR CAR. YOUR COMFORT.
            </p>
            <h1>
              Your journey.
              <br />A little more
              <br />
              <em>freedom.</em>
            </h1>
            <p className="intro">
              {text(
                "welcome",
                "A driver for your own car, when you need one. Plan your ride, meet your assigned driver and follow your journey with Hyzz.",
              )}
            </p>
            <div className="actions">
              <a className="button" href="#downloads">
                Find your Hyzz app <span>↗</span>
              </a>
              <a className="button light" href="#how">
                See how it works
              </a>
            </div>
            <div className="trust">
              <span>✓ Document review</span>
              <span>⌖ Trip location sharing</span>
              <span>₹ Clear estimates</span>
            </div>
          </div>
          <div className="hero-art">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <img
              src="/hyzz-journey.png"
              alt="Hyzz driver standing beside a customer-owned car"
            />
            <div className="floating-card">
              <span className="pin">⌖</span>
              <div>
                <strong>Your car, in good company.</strong>
                <small>From pickup to your next destination.</small>
              </div>
            </div>
            <div className="small-card">
              H <span>Let’s get you there.</span>
            </div>
          </div>
        </section>
        <div className="ticker" aria-label="Services">
          <span>YOUR OWN CAR</span>
          <b>✳</b>
          <span>HOURLY PLANS</span>
          <b>✳</b>
          <span>DISTANCE TRIPS</span>
          <b>✳</b>
          <span>FULL-DAY PLANS</span>
        </div>
        <section id="how" className="section">
          <p className="eyebrow">LESS PLANNING. MORE LIVING.</p>
          <div className="section-heading">
            <h2>
              A few taps.
              <br />A smoother day.
            </h2>
            <p>
              Keep the comfort of your car. Let Hyzz help you arrange the
              driver.
            </p>
          </div>
          <div className="cards">
            {[
              [
                "01",
                "Make it your trip",
                "Pick your location, destination and preferred time. Review the fare estimate before requesting.",
              ],
              [
                "02",
                "Meet your driver",
                "Your assigned driver and trip status appear in the app. Check their details and share your pickup code on arrival.",
              ],
              [
                "03",
                "Enjoy the journey",
                "Follow location updates during the assigned trip. After completion, confirm cash payment and share your rating.",
              ],
            ].map(([n, t, d]) => (
              <article key={n}>
                <span className="number">{n}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </article>
            ))}
          </div>
          <p className="guide">
            {text(
              "customer_guide",
              "Availability depends on service area and approved drivers. Address and journey details are entered in the customer app.",
            )}
          </p>
        </section>
        <section id="partners" className="partner section">
          <div>
            <p className="eyebrow">DRIVE YOUR NEXT CHAPTER</p>
            <h2>
              Good at driving?
              <br />
              Let’s go places.
            </h2>
            <p>
              {text(
                "driver_guide",
                "Sign up with email, submit the required driver documents and wait for administrator review. Approved drivers can go online, review requests and manage trips and earnings.",
              )}
            </p>
            <a className="button lime" href="#downloads">
              Explore the driver app ↗
            </a>
          </div>
          <div className="partner-list">
            {[
              [
                "01",
                "Your documents, reviewed",
                "Driving licence, identity, insurance and police verification are reviewed by operations.",
              ],
              [
                "02",
                "Requests you can review",
                "See pickup and destination details before accepting eligible nearby requests.",
              ],
              [
                "03",
                "Your work, in one place",
                "Bookings, cash confirmations, earnings, wallet credits and support requests.",
              ],
            ].map(([n, t, d]) => (
              <article key={n}>
                <b>{n}</b>
                <div>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section id="downloads" className="section">
          <p className="eyebrow">TAKE HYZZ WITH YOU</p>
          <h2>
            Two apps.
            <br />
            One connected journey.
          </h2>
          <div className="download-grid">
            {["customer", "driver"].map((a) => (
              <article key={a}>
                <img src="/hyzz-mark.svg" alt="" />
                <p className="eyebrow">HYZZ {a.toUpperCase()}</p>
                <h3>
                  {a === "customer"
                    ? "Your next ride starts here."
                    : "Your next trip awaits."}
                </h3>
                <p>
                  {a === "customer"
                    ? "Book a driver for your car and manage your journey."
                    : "Manage requests, trips, earnings and your driver profile."}
                </p>
                {releases[a] ? (
                  <>
                    <a
                      className="button"
                      href={
                        API + "/api/v1/releases/" + releases[a].id + "/download"
                      }
                    >
                      Download Android APK ↗
                    </a>
                    <small>
                      Version {releases[a].version} · Android approves
                      installation
                    </small>
                  </>
                ) : (
                  <a className="button light" href="#contact">
                    Ask about app availability
                  </a>
                )}
              </article>
            ))}
          </div>
          <p className="guide">
            Download the app for your role. Service availability depends on your location and approved drivers.
          </p>
        </section>
        <section className="section faq">
          <div>
            <p className="eyebrow">GOOD TO KNOW</p>
            <h2>
              A little clarity
              <br />
              before you go.
            </h2>
          </div>
          <div>
            {[
              [
                "Do I need my own car?",
                "Yes. Hyzz arranges a driver for the customer’s car. Customer car details and document uploads are optional in the current app.",
              ],
              [
                "How do I sign in?",
                "Use your email to receive a verification code. Contact Hyzz if you need help with your account or staff access.",
              ],
              [
                "Can I track my trip?",
                "Assigned trips share driver location when permission and connectivity allow. Battery restrictions, force-stop and network loss can interrupt updates.",
              ],
              [
                "How do payments work?",
                "The current app supports cash confirmation. Any wallet payout request is reviewed and paid separately by the operator.",
              ],
            ].map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        <section id="contact" className="contact section">
          <div>
            <p className="eyebrow">LET’S TALK</p>
            <h2>
              We’re here
              <br />
              to get you started.
            </h2>
            <p>
              Questions about booking, joining as a driver or business access?
              Send the Hyzz team an enquiry.
            </p>
            {phone && (
              <a className="contact-link" href={"tel:" + phone}>
                {phone}
              </a>
            )}
            {whatsapp && (
              <a
                className="contact-link"
                href={"https://wa.me/" + whatsapp.replace(/\D/g, "")}
              >
                Chat on WhatsApp ↗
              </a>
            )}
            {email && (
              <a className="contact-link" href={"mailto:" + email}>
                {email}
              </a>
            )}
            <small>
              Response times depend on team availability. For an emergency,
              contact local emergency services.
            </small>
          </div>
          <form onSubmit={contact}>
            <h3>How can we help?</h3>
            <div className="form-row">
              <label>
                Your name
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={100}
                  autoComplete="name"
                />
              </label>
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                />
              </label>
            </div>
            <label>
              Phone (optional)
              <input
                name="phone"
                type="tel"
                autoComplete="tel"
                placeholder="+91"
              />
            </label>
            <label>
              I’m interested in
              <select name="topic">
                <option value="customer">Booking a driver</option>
                <option value="driver">Joining as a driver</option>
                <option value="business">Business / staff access</option>
                <option value="support">Application support</option>
              </select>
            </label>
            <label>
              Message
              <textarea
                name="message"
                required
                minLength={10}
                maxLength={2000}
                rows={4}
              />
            </label>
            <label className="honey" aria-hidden="true">
              Website
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
            <label className="consent">
              <input name="consent" type="checkbox" required />I agree Hyzz may
              use these details to respond to my enquiry.
            </label>
            <button className="button" disabled={sending}>
              {sending ? "Sending…" : "Send enquiry ↗"}
            </button>
            <p role="status">{status}</p>
          </form>
        </section>
        {error && (
          <p className="site-status" role="alert">
            {error}
          </p>
        )}
      </main>
      <footer>
        <a className="brand" href="#">
          <img src="/hyzz-mark.svg" alt="" />
          hyzz<span>.</span>
        </a>
        <p>Your car. Your journey. Your Hyzz.</p>
        <div>
          {content
            .filter(
              (c) =>
                ![
                  "welcome",
                  "customer_guide",
                  "driver_guide",
                  "contact_phone",
                  "contact_email",
                  "contact_whatsapp",
                ].includes(c.key),
            )
            .map((c) => (
              <button key={c.key} onClick={() => setPolicy(c)}>
                {c.title}
              </button>
            ))}
          <a href={ADMIN}>Staff sign in</a>
        </div>
        <small>
          © {new Date().getFullYear()} Hyzz. Service availability and operator
          policies apply.
        </small>
      </footer>
      {policy && (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label={policy.title}
        >
          <article>
            <button className="close" onClick={() => setPolicy(null)} autoFocus>
              Close ✕
            </button>
            <h2>{policy.title}</h2>
            <p className="policy">{policy.body}</p>
          </article>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);

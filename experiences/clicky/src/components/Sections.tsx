import { useRive } from "@rive-app/react-canvas";
import { PricingSky } from "./PricingSky";
import { useState } from "react";
import { faqs, plans, tweets } from "../data/content";
import { Draggable } from "./Draggable";
import { assetUrl } from "../lib/assetUrl";

function FooterRive() {
  const { RiveComponent } = useRive({
    src: assetUrl("footer.riv"),
    autoplay: true,
  });
  return <RiveComponent className="footer-rive-canvas" />;
}

function FeatWave() {
  const heights = [75, 36, 66, 48, 29, 32, 44, 44, 49, 55, 38, 62, 41, 70, 33];
  return (
    <div className="feat-wave" aria-hidden="true">
      <div className="wbars">
        {heights.map((h, i) => (
          <i key={i} style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

function FeatBubble({
  color,
  label,
  compact,
}: {
  color: "blue" | "orange" | "teal";
  label?: string;
  compact?: boolean;
}) {
  return (
    <div className={`feat-pill ${color} feat-bubble ${compact ? "rep" : "req"}`}>
      {label ? <span>{label}</span> : <span className="feat-pill-dot" />}
    </div>
  );
}

export function Features() {
  const items = [
    {
      title: "finally do the thing",
      body: "from fl studio to claude code, jump into any tool, ask questions and heyclicky draws on your screen and teaches you.",
      src: assetUrl("clicky-fl.mp4"),
      poster: assetUrl("clicky-fl-poster.webp"),
      winTitle: "FL Studio",
      bubble: "blue" as const,
      flip: false,
    },
    {
      title: "use your screen as context",
      body: "if you hit a wall, you can show heyclicky and it'll walk you through the next step.",
      src: assetUrl("clicky-spatial.mp4"),
      poster: assetUrl("clicky-spatial-poster.webp"),
      winTitle: "Preview",
      bubble: "orange" as const,
      flip: true,
    },
    {
      title: "spawn agents with your voice",
      body: "we let you spawn ai agents with just your voice no terminal needed. connect your gmail or notion and start doing stuff.",
      src: assetUrl("clicky-agent.mp4"),
      poster: assetUrl("clicky-agent-poster.webp"),
      winTitle: "Google Sheets",
      bubble: "teal" as const,
      flip: false,
    },
  ];
  return (
    <section className="feat" id="feat">
      <div className="feat-rows">
        {items.map((item) => (
          <div
            key={item.title}
            className={`feat-row ${item.flip ? "flip" : ""}`}
          >
            <div className="feat-trans">
              <FeatWave />
              <FeatBubble color={item.bubble} label="heyclicky" />
              <FeatBubble color="orange" compact />
              <div className="feat-copy">
                <p className="feat-h">{item.title}</p>
                <p className="feat-d">{item.body}</p>
              </div>
            </div>
            <div className="feat-desktop">
              <img className="feat-bg bg" src={assetUrl("f-window.avif")} alt="" />
              <div className="feat-fig">
                <div className="feat-bar">
                  <div className="feat-dots">
                    <img src={assetUrl("win-close.png")} alt="" />
                    <img src={assetUrl("win-min.png")} alt="" />
                    <img src={assetUrl("win-zoom.png")} alt="" />
                  </div>
                  <div className="feat-bar-title">{item.winTitle}</div>
                </div>
                <div className="feat-canvas">
                  <video
                    className="no-drag"
                    src={item.src}
                    poster={item.poster}
                    autoPlay
                    muted
                    loop
                    playsInline
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Manifesto() {
  return (
    <section className="man-section">
      <Draggable
        as="img"
        src={assetUrl("man-cat.avif")}
        alt=""
        className="decor man-decor"
        data-prop="cat"
        style={{ left: 337, top: 140, width: 96 }}
      />
      <Draggable
        as="img"
        src={assetUrl("man-mail.webp")}
        alt="you've got mail"
        className="decor man-decor"
        data-prop="mail"
        style={{ left: 989, top: 229, width: 70 }}
      />
      <Draggable
        as="img"
        src={assetUrl("m-flower.avif")}
        alt=""
        className="decor man-decor"
        data-prop="flower"
        style={{ left: "50%", top: -8, width: 56, transform: "translateX(-50%)" }}
      />
      <Draggable
        as="img"
        src={assetUrl("man-astro.avif")}
        alt=""
        className="decor man-decor"
        data-prop="astro"
        style={{ left: 234, top: 495, width: 63 }}
      />
      <Draggable
        as="img"
        src={assetUrl("man-laptop.avif")}
        alt=""
        className="decor man-decor"
        data-prop="laptop"
        style={{ left: 1087, top: 540, width: 137 }}
      />
      <div className="man-inner">
        <p>we all have access to the same ai models, yet very few of us unlock their full power!</p>
        <p>we just believe it’s an interface problem.</p>
        <div className="man-video">
          <img
            className="man-arches-poster"
            src={assetUrl("man-arches-poster.webp")}
            alt=""
          />
          <video
            src={assetUrl("arches.mp4")}
            poster={assetUrl("man-arches-poster.webp")}
            autoPlay
            muted
            loop
            playsInline
          />
        </div>
        <p>
          we wanna take the same frontier models everyone else is using, and make it so this
          technology can break out of uninspired chat interfaces and clunky terminals.
        </p>
        <p>we’re trying to figure out the ai interface the next billion people will use.</p>
        <p>it’s early! try out what we have today and lmk what you think.</p>
        <div className="man-sign">
          <img src={assetUrl("man-farza-src.webp")} alt="Farza" />
          <div>
            <strong>farza, founder</strong>
            <div>
              <img
                src={assetUrl("man-heyclicky-mark.avif")}
                alt="heyclicky"
                style={{ width: 120, marginTop: 6 }}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function SocialProof() {
  return (
    <section className="fb">
      <div className="fb-plabel">feedback</div>
      <div className="fb-marquee" aria-hidden="true">
        <div className="fb-marquee-track">
          <span>they use it everyday</span>
          <span>they use it everyday</span>
          <span className="on">they use it everyday</span>
          <span>they use it everyday</span>
          <span>they use it everyday</span>
        </div>
      </div>
      <Draggable
        as="img"
        className="fb-sticker"
        data-prop="noregrets"
        src={assetUrl("noregrets.avif")}
        alt="No Regrets!"
      />
      <div className="fb-wall">
        {tweets.map((t) => (
          <a key={t.handle} className="fb-card" href={t.href} target="_blank" rel="noreferrer">
            <div className="fb-bar-chrome" style={{ background: t.color }}>
              <span className="fb-dots">
                <img src={assetUrl("win-close.png")} alt="" />
                <img src={assetUrl("win-min.png")} alt="" />
                <img src={assetUrl("win-zoom.png")} alt="" />
              </span>
              <img className="fb-x" src={assetUrl("win-x.svg")} alt="" />
            </div>
            <div className="fb-body">
              <div className="fb-head">
                <img className="fb-av" src={t.avatar} alt="" />
                <div className="fb-who">
                  <span className="fb-name">{t.name}</span>
                  <span className="fb-handle">{t.handle}</span>
                </div>
                <img className="fb-follow" src={assetUrl("fb-follow.svg")} alt="" />
              </div>
              <p className="fb-text">{t.text}</p>
              <div className="fb-time">
                <span>{t.time}</span>
                {t.replies ? (
                  <span>
                    <img src={assetUrl("fb-repost.svg")} alt="" /> {t.replies}
                  </span>
                ) : null}
                {t.likes ? (
                  <span>
                    <img src={assetUrl("fb-like.svg")} alt="" /> {t.likes}
                  </span>
                ) : null}
              </div>
            </div>
          </a>
        ))}
      </div>
      <div className="fb-cta">
        <video src={assetUrl("fb-thumb.mp4")} autoPlay muted loop playsInline />
        <div>
          25,000+ happy users and counting.{" "}
          <a href="#pricing">join them</a>
        </div>
      </div>
    </section>
  );
}

export function Pricing() {
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const list = plans[period];
  return (
    <section className="pr" id="pricing">
      <PricingSky />
      <div className="pr-sky-overlay" aria-hidden="true" />
      <div className="pr-inner">
        <div className="pr-header">
          <div className="pr-plabel">pricing</div>
          <h2 className="pr-title">heyclicky, your way</h2>
          <p className="pr-sub">three simple plans, cancel anytime.</p>
        </div>
        <div className="pr-toggle" role="tablist" aria-label="billing period">
          <button
            type="button"
            role="tab"
            aria-selected={period === "monthly"}
            className={`pr-seg ${period === "monthly" ? "on" : ""}`}
            onClick={() => setPeriod("monthly")}
          >
            <span className="pr-seg-label">monthly</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={period === "yearly"}
            className={`pr-seg ${period === "yearly" ? "on" : ""}`}
            onClick={() => setPeriod("yearly")}
          >
            <span className="pr-seg-label">yearly</span>
            <span className="pr-chip">-20%</span>
          </button>
        </div>

        <div className="pr-cards">
          {list.map((p) => (
            <article key={p.name} className={`pr-card ${p.popular ? "popular" : ""}`}>
              {p.popular ? <span className="pr-popular">popular</span> : null}
              {p.name === "max" ? (
                <>
                  <Draggable
                    as="img"
                    className="pr-cap-sticker"
                    data-prop="cap"
                    src={assetUrl("pr-cap.png")}
                    alt=""
                  />
                  <Draggable
                    as="img"
                    className="pr-nocap"
                    data-prop="pr-nocap"
                    src={assetUrl("pr-nocap.svg")}
                    alt="no cap!"
                  />
                </>
              ) : null}
              <div className="pr-card-bar">
                <span className="pr-dots">
                  <img src={assetUrl("win-close.png")} alt="" />
                  <img src={assetUrl("win-min.png")} alt="" />
                  <img src={assetUrl("win-zoom.png")} alt="" />
                </span>
              </div>
              <div className="pr-card-body">
                <p className="pr-card-title">{p.name}</p>
                <p className="pr-card-tagline">{p.blurb}</p>
                <p className="pr-card-subtag">{p.best}</p>
                <div className="pr-divider" aria-hidden="true" />
                <div className="pr-price-block">
                  <div className="pr-price">{p.price}</div>
                  <p className="pr-price-note">{p.billing}</p>
                  <a
                    className={`btn pr-cta ${p.popular ? "btn-mac" : "btn-plan-light"}`}
                    href="#"
                  >
                    {p.popular ? <span className="gloss" /> : null}
                    <span>{p.cta}</span>
                  </a>
                </div>
                <div className="pr-divider" aria-hidden="true" />
                <div className="pr-inc">
                  <p className="pr-inc-label">includes</p>
                  <ul>
                    {p.includes.map((line) => (
                      <li key={line}>
                        <img className="pr-inc-check" src={assetUrl("pr-check.svg")} alt="" />
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="pr-builder-wrap">
          <Draggable
            as="img"
            className="pr-builder-ship"
            data-prop="justshipit"
            src={assetUrl("pr-justshipit.png")}
            alt=""
          />
          <div className="pr-builder">
            <div className="pr-builder-bar">
              <span className="pr-dots">
                <img src={assetUrl("win-close.png")} alt="" />
                <img src={assetUrl("win-min.png")} alt="" />
                <img src={assetUrl("win-zoom.png")} alt="" />
              </span>
            </div>
            <div className="pr-builder-panel">
              <div className="pr-builder-row">
                <div className="pr-builder-copy">
                  <p className="pr-builder-title">{"< maker discount >"}</p>
                  <p className="pr-builder-sub">
                    if you’re making an app, a yt channel, or your own project, show us! we’ll give
                    you 50% off your first month on pro to help you out *
                  </p>
                </div>
                <a className="btn btn-plan-light pr-builder-btn" href="https://tally.so/r/BzVE6R" target="_blank" rel="noreferrer">
                  <span className="gloss" />
                  <span>reach out to us</span>
                </a>
              </div>
            </div>
            <Draggable
              as="img"
              className="pr-builder-octocat"
              data-prop="octocat"
              src={assetUrl("pr-octocat.svg")}
              alt=""
            />
            <Draggable
              as="img"
              className="pr-builder-robot"
              data-prop="robot"
              src={assetUrl("pr-robot.svg")}
              alt=""
            />
          </div>
          <p className="pr-builder-note">* open to new and existing subs.</p>
        </div>
      </div>
    </section>
  );
}

export function Faq() {
  return (
    <section className="faq">
      <h2>frequently asked questions</h2>
      <p className="lede">what to know about heyclicky, privacy, and getting started.</p>
      {faqs.map((f, i) => (
        <details key={f.q} open={i === 0}>
          <summary>{f.q}</summary>
          <p>{f.a}</p>
        </details>
      ))}
      <div className="faq-video">
        <video src={assetUrl("faq-office.mp4")} autoPlay muted loop playsInline />
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div>
        <img src={assetUrl("footer-wordmark.webp")} alt="heyclicky" width={140} />
        <p className="fine" style={{ marginTop: 12 }}>
          an ai buddy that lives on your mac
        </p>
      </div>
      <div>
        <h4>product</h4>
        <a href="#feat">features</a>
        <a href="#pricing">pricing</a>
        <a href="#top">try it</a>
      </div>
      <div>
        <h4>resources</h4>
        <a href={assetUrl("privacy-policy.html")}>privacy</a>
        <a href="mailto:hi@heyclicky.com">support</a>
      </div>
      <div>
        <h4>connect</h4>
        <a href="https://instagram.com/_heyclicky" target="_blank" rel="noreferrer">
          instagram
        </a>
        <a href="https://x.com/heyclicky" target="_blank" rel="noreferrer">
          x (twitter)
        </a>
        <a href="https://www.linkedin.com/company/heyclicky" target="_blank" rel="noreferrer">
          linkedin
        </a>
        <a href="https://www.youtube.com/@heyclicky" target="_blank" rel="noreferrer">
          youtube
        </a>
      </div>
      <div className="footer-rive" aria-hidden="true">
        <FooterRive />
      </div>
      <p className="disclaimer">
        *heyclicky only sees your screen when you press the hotkey - screenshots are never stored*
      </p>
    </footer>
  );
}

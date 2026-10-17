// Co-Pilot site forms: every form with data-lead posts to /api/lead.
// The Worker forwards each sign-up to SecondBrain (see src/worker.js).
(function () {
  var DONE = {
    waitlist: {
      title: "You're on the list.",
      body: "Your founding rate is locked in at $50 a month. I'll write when doors open, and your answers shape your first briefing.",
    },
    pricing: {
      title: "Got it.",
      body: "I'll reply within one business day with a quote and times.",
      book: { href: "/book/intro", label: "Want to talk sooner? Book a 15-minute intro" },
    },
    founder: {
      title: "Thank you.",
      body: "We'll reach out personally.",
      book: { href: "/book/30", label: "Or pick a time now: book 30 minutes" },
    },
    studio: {
      title: "You're in line.",
      body: "You'll hear first when Edition 01's city and dates are set.",
    },
    collective: {
      title: "Thanks for reaching out.",
      body: "We'll take a look at what you built and get back to you.",
    },
  };

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text) n.textContent = text;
    return n;
  }

  function fallbackLink(kind, data) {
    var lines = [];
    data.forEach(function (v, k) {
      if (k !== "website" && v) lines.push(k + ": " + v);
    });
    var subject = "Co-Pilot " + kind;
    return (
      "mailto:shawn@energiacres.com?subject=" +
      encodeURIComponent(subject) +
      "&body=" +
      encodeURIComponent(lines.join("\n"))
    );
  }

  function onSubmit(e) {
    var form = e.currentTarget;
    var kind = form.getAttribute("data-lead");
    e.preventDefault();
    if (!form.reportValidity()) return;

    var button = form.querySelector('button[type="submit"]');
    var data = new FormData(form);
    var payload = { kind: kind, page: location.pathname };
    data.forEach(function (v, k) {
      payload[k] = String(v);
    });

    var old = form.querySelector(".form-msg");
    if (old) old.remove();
    if (button) {
      button.disabled = true;
      button.dataset.label = button.textContent;
      button.textContent = "Sending…";
    }

    fetch("/api/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r.json().catch(function () {
          return {};
        }).then(function (j) {
          if (!r.ok || !j.ok) throw new Error(j.error || "failed");
        });
      })
      .then(function () {
        var copy = DONE[kind] || DONE.waitlist;
        var box = el("div", { class: "form-done", role: "status", tabindex: "-1" });
        box.appendChild(el("p", { class: "sub", style: "margin:0" }, copy.title));
        box.appendChild(el("p", { class: "txt", style: "margin:0;opacity:.75" }, copy.body));
        if (copy.book) {
          var a = el("a", { href: copy.book.href, class: "txt" }, copy.book.label + " ›");
          box.appendChild(a);
        }
        form.replaceWith(box);
        box.focus();
        if (window.gtag) window.gtag("event", "generate_lead", { lead_kind: kind });
      })
      .catch(function () {
        if (button) {
          button.disabled = false;
          button.textContent = button.dataset.label || "Send";
        }
        var msg = el("p", { class: "form-msg", role: "alert" });
        msg.appendChild(document.createTextNode("Something went wrong on our side. "));
        msg.appendChild(el("a", { href: fallbackLink(kind, data) }, "Send it by email instead"));
        msg.appendChild(document.createTextNode(" and nothing gets lost."));
        form.appendChild(msg);
      });
  }

  var forms = document.querySelectorAll("form[data-lead]");
  for (var i = 0; i < forms.length; i++) forms[i].addEventListener("submit", onSubmit);
})();

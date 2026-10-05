(function () {
  var ORIGINS = {
    "30a": "https://www.eatingon30a.com",
    destin: "https://www.eatingindestin.com"
  };
  var LABELS = { "30a": "30A", destin: "Destin" };
  var configPromise = null;
  var mePromise = null;

  function config() {
    if (!configPromise) {
      configPromise = fetch("/api/account/config", { credentials: "same-origin" })
        .then(function (response) { return response.json(); })
        .catch(function () { return { ok: false, site: "", accountsOrigin: "" }; });
    }
    return configPromise;
  }

  function me() {
    if (!mePromise) {
      mePromise = fetch("/api/account/me", { credentials: "same-origin" })
        .then(function (response) { return response.json(); })
        .catch(function () { return { user: null }; });
    }
    return mePromise;
  }

  function refreshMe() {
    mePromise = null;
    return me();
  }

  function icon(kind, on) {
    var fill = on ? "currentColor" : "none";
    if (kind === "favorite") {
      return '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z" fill="' + fill + '" stroke="currentColor" stroke-width="1.6"></path></svg>';
    }
    return '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3.2L6 20V5.5a1 1 0 0 1 1-1z" fill="' + fill + '" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path></svg>';
  }

  function refreshNav() {
    var link = document.querySelector("[data-account-nav]");
    if (!link) return;
    me().then(function (payload) {
      if (payload && payload.user) {
        link.textContent = "My places";
        link.setAttribute("href", "/my-places/");
      } else {
        link.textContent = "Sign in";
        link.setAttribute("href", "/account/");
      }
      var path = location.pathname;
      if (path.length > 1 && path.endsWith("/")) path = path;
      else if (path !== "/") path = path + "/";
      var href = link.getAttribute("href");
      if (path === href) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function listingSlug() {
    var parts = location.pathname.split("/").filter(Boolean);
    if (parts.length === 2 && parts[0] === "restaurants") return parts[1];
    return "";
  }

  function placeHref(save, current) {
    var path = "/restaurants/" + encodeURIComponent(save.slug) + "/";
    if (save.site === current) return path;
    return (ORIGINS[save.site] || "") + path;
  }

  function signInHref() {
    return "/account/?next=" + encodeURIComponent(location.pathname);
  }

  function putSave(payload) {
    return fetch("/api/account/saves", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (response) {
      if (response.status === 401) {
        location.href = signInHref();
        return null;
      }
      return response.json().then(function (body) {
        return { ok: response.ok, body: body };
      });
    });
  }

  var savesPromise = null;
  var savesCache = null;

  function loadSaves() {
    if (savesCache) return Promise.resolve(savesCache);
    if (!savesPromise) {
      savesPromise = me().then(function (payload) {
        if (!payload || !payload.user) {
          savesCache = [];
          return savesCache;
        }
        return Promise.all([
          fetch("/api/account/saves", { credentials: "same-origin" }).then(function (response) { return response.json(); }),
          config()
        ]).then(function (parts) {
          var body = parts[0];
          var cfg = parts[1];
          var site = cfg && cfg.site;
          savesCache = ((body && body.saves) || []).filter(function (save) {
            return !site || save.site === site;
          });
          return savesCache;
        }).catch(function () {
          savesCache = [];
          return savesCache;
        });
      });
    }
    return savesPromise;
  }

  function syncCache(slug, kind, saved, name, area) {
    if (!savesCache) return;
    savesCache = savesCache.filter(function (save) {
      return !(save.slug === slug && save.kind === kind);
    });
    if (saved) savesCache.push({ slug: slug, kind: kind, name: name, area: area });
  }

  function paintBar(bar, slug) {
    loadSaves().then(function (saves) {
      var buttons = bar.querySelectorAll("[data-kind]");
      for (var i = 0; i < buttons.length; i++) {
        var button = buttons[i];
        if (button.getAttribute("data-save-busy") === "1") continue;
        var kind = button.getAttribute("data-kind");
        var on = false;
        for (var j = 0; j < saves.length; j++) {
          if (saves[j].slug === slug && saves[j].kind === kind) {
            on = true;
            break;
          }
        }
        setPressed(button, on);
      }
    });
  }

  function bindSaveBar(bar, slug, name, area, remember) {
    var note = bar.querySelector(".save-note");
    bar.addEventListener("click", function (event) {
      var button = event.target.closest("[data-kind]");
      if (!button || !bar.contains(button)) return;
      event.preventDefault();
      event.stopPropagation();
      toggle(button, slug, name, area, note, remember);
    });
    paintBar(bar, slug);
  }

  function mountSaves() {
    var slug = listingSlug();
    var head = document.querySelector("article.profile .profile-head");
    if (!slug || !head || head.querySelector(".save-bar")) return;
    var title = head.querySelector("h1");
    if (!title) return;
    var areaLink = head.querySelector(".eyebrow a");
    var name = title.textContent.replace(/\s+/g, " ").trim();
    var area = areaLink ? areaLink.textContent.replace(/\s+/g, " ").trim() : "";
    var bar = document.createElement("div");
    bar.className = "save-bar";
    bar.innerHTML = buttonHtml("favorite", false) + buttonHtml("want", false) + '<p class="save-note" role="status"></p>';
    var panel = document.createElement("div");
    panel.className = "personal-note";
    panel.hidden = true;
    panel.innerHTML = '<label class="personal-note-label"><span>Your note</span><textarea maxlength="280" rows="3" placeholder="Add a personal note..."></textarea></label><div class="note-actions"><button type="button" class="button" data-note-save>Save note</button><button type="button" class="button secondary" data-note-clear>Clear</button></div><p class="personal-note-hint">Only you can see this. It also shows on My places. About 280 characters.</p><p class="personal-note-status" role="status" aria-live="polite"></p>';
    var chips = head.querySelector(".chips");
    if (chips) head.insertBefore(bar, chips);
    else head.appendChild(bar);
    bar.insertAdjacentElement("afterend", panel);
    var field = panel.querySelector("textarea");
    var noteStatus = panel.querySelector(".personal-note-status");
    var savedKinds = {};
    var stored = "";

    function showPanel() {
      var on = Object.keys(savedKinds).length > 0;
      panel.hidden = !on;
      if (!on) noteStatus.textContent = "";
    }

    function remember(kind, on, copiedNote, settled) {
      if (on) savedKinds[kind] = true;
      else delete savedKinds[kind];
      if (settled && !on && !Object.keys(savedKinds).length) {
        field.value = "";
        stored = "";
      } else if (copiedNote && !stored) {
        stored = copiedNote;
        field.value = copiedNote;
      }
      showPanel();
    }

    function writeListingNote(text, clearing) {
      var kinds = Object.keys(savedKinds);
      if (!kinds.length) return;
      if (text.length > 280) {
        noteStatus.textContent = "Keep the note under 280 characters.";
        return;
      }
      noteStatus.textContent = "";
      var buttons = panel.querySelectorAll("button");
      buttons.forEach(function (button) { button.disabled = true; });
      Promise.all(kinds.map(function (kind) {
        return putSave({ slug: slug, name: name, area: area, kind: kind, saved: true, note: text });
      })).then(function (results) {
        buttons.forEach(function (button) { button.disabled = false; });
        if (results.some(function (result) { return !result; })) return;
        var failed = results.find(function (result) { return !result.ok; });
        if (failed) {
          field.value = stored;
          noteStatus.textContent = (failed.body && failed.body.error) || "That note could not be saved.";
          return;
        }
        var savedNote = results[0].body && typeof results[0].body.note === "string" ? results[0].body.note : text.trim();
        stored = savedNote;
        field.value = savedNote;
        noteStatus.textContent = clearing || !savedNote ? "Note cleared." : "Note saved.";
      }).catch(function () {
        buttons.forEach(function (button) { button.disabled = false; });
        field.value = stored;
        noteStatus.textContent = "That note could not be saved.";
      });
    }

    panel.querySelector("[data-note-save]").addEventListener("click", function () {
      writeListingNote(field.value, false);
    });
    panel.querySelector("[data-note-clear]").addEventListener("click", function () {
      field.value = "";
      writeListingNote("", true);
    });

    bindSaveBar(bar, slug, name, area, remember);
    loadSaves().then(function (saves) {
      var text = "";
      saves.forEach(function (save) {
        if (save.slug !== slug) return;
        var button = bar.querySelector('[data-kind="' + save.kind + '"]');
        if (button && button.getAttribute("data-save-busy") === "1") return;
        savedKinds[save.kind] = true;
        if (save.kind === "favorite" && save.note) text = save.note;
        else if (!text && save.note) text = save.note;
      });
      if (!stored) {
        stored = text;
        field.value = text;
      }
      showPanel();
    });
  }

  function mountCardSaves(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var hosts = scope.querySelectorAll(".card[data-slug][data-name], .map-hit[data-slug][data-name]");
    if (!hosts.length) return;
    for (var i = 0; i < hosts.length; i++) {
      var host = hosts[i];
      if (host.querySelector(".save-bar")) continue;
      var slug = host.getAttribute("data-slug") || "";
      var name = host.getAttribute("data-name") || "";
      if (!slug || !name) continue;
      var area = host.getAttribute("data-place-area") || "";
      var bar = document.createElement("div");
      bar.className = "save-bar";
      bar.innerHTML = buttonHtml("favorite", false) + buttonHtml("want", false) + '<p class="save-note" role="status"></p>';
      var photo = host.querySelector(".card-media, .map-thumb");
      if (photo) photo.appendChild(bar);
      else host.appendChild(bar);
      bindSaveBar(bar, slug, name, area);
    }
  }

  function watchMapList() {
    var list = document.querySelector("#map-list");
    if (!list || list.getAttribute("data-save-watch") === "true") return;
    list.setAttribute("data-save-watch", "true");
    var queued = false;
    var observer = new MutationObserver(function () {
      if (queued) return;
      queued = true;
      queueMicrotask(function () {
        queued = false;
        mountCardSaves(list);
      });
    });
    observer.observe(list, { childList: true });
    mountCardSaves(list);
  }

  function buttonHtml(kind, on) {
    var label = kind === "favorite" ? "Favorite" : "Want to try";
    return '<button type="button" class="save-button" data-kind="' + kind + '" aria-pressed="' + (on ? "true" : "false") + '">' + icon(kind, on) + "<span>" + label + "</span></button>";
  }

  function setPressed(button, on) {
    var kind = button.getAttribute("data-kind");
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.innerHTML = icon(kind, on) + "<span>" + (kind === "favorite" ? "Favorite" : "Want to try") + "</span>";
  }

  function toggle(button, slug, name, area, note, remember) {
    var kind = button.getAttribute("data-kind");
    me().then(function (payload) {
      if (!payload || !payload.user) {
        location.href = signInHref();
        return;
      }
      return loadSaves().then(function () {
        var next = button.getAttribute("aria-pressed") !== "true";
        button.setAttribute("data-save-busy", "1");
        setPressed(button, next);
        syncCache(slug, kind, next, name, area);
        if (remember) remember(kind, next);
        return putSave({ slug: slug, name: name, area: area, kind: kind, saved: next }).then(function (result) {
          button.removeAttribute("data-save-busy");
          if (!result) return;
          if (!result.ok) {
            setPressed(button, !next);
            syncCache(slug, kind, !next, name, area);
            if (remember) remember(kind, !next);
            if (note) note.textContent = (result.body && result.body.error) || "That place could not be saved.";
            return;
          }
          if (note) note.textContent = next ? "Saved." : "Removed.";
          if (remember) {
            var copied = next && result.body && typeof result.body.note === "string" ? result.body.note : "";
            remember(kind, next, copied, true);
          }
        }).catch(function () {
          button.removeAttribute("data-save-busy");
          setPressed(button, !next);
          syncCache(slug, kind, !next, name, area);
          if (remember) remember(kind, !next);
          if (note) note.textContent = "That place could not be saved.";
        });
      });
    });
  }

  function queryParam(name) {
    return new URLSearchParams(location.search).get(name) || "";
  }

  function continueSignIn(cfg, next) {
    if (!cfg || !cfg.accountsOrigin || !cfg.site) return false;
    var finish = new URL("/api/account/finish", location.origin);
    finish.searchParams.set("next", next || "/my-places/");
    var dest = new URL("/v1/continue", cfg.accountsOrigin);
    dest.searchParams.set("site", cfg.site);
    dest.searchParams.set("return", finish.toString());
    location.href = dest.toString();
    return true;
  }

  function mountSignIn(root) {
    var form = root.querySelector("[data-magic]");
    var status = root.querySelector(".account-status");
    var signed = root.querySelector("[data-signed]");
    if (queryParam("error") === "expired" && status) {
      status.textContent = "That link expired. Request a new one.";
    }
    var nextField = document.createElement("input");
    nextField.type = "hidden";
    nextField.name = "next";
    nextField.value = queryParam("next") || "/my-places/";
    if (form) form.appendChild(nextField);

    me().then(function (payload) {
      if (payload && payload.user) {
        if (form) form.hidden = true;
        if (signed) {
          signed.hidden = false;
          signed.textContent = "";
          var line = document.createElement("p");
          line.textContent = "You are signed in as " + payload.user.email + ".";
          var places = document.createElement("a");
          places.className = "button";
          places.href = "/my-places/";
          places.textContent = "My places";
          var out = document.createElement("button");
          out.type = "button";
          out.className = "button secondary";
          out.textContent = "Sign out";
          out.addEventListener("click", signOut);
          signed.appendChild(line);
          var row = document.createElement("p");
          row.className = "action-row";
          row.appendChild(places);
          row.appendChild(out);
          signed.appendChild(row);
        }
        return;
      }
      if (queryParam("need") === "1") return;
      config().then(function (cfg) {
        continueSignIn(cfg, nextField.value);
      });
    });

    if (!form) return;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var email = form.email.value.trim();
      var coupons30a = form.coupons30a && form.coupons30a.checked === true;
      var couponsDestin = form.couponsDestin && form.couponsDestin.checked === true;
      status.textContent = "";
      fetch("/api/account/request", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email,
          coupons30a: coupons30a,
          couponsDestin: couponsDestin,
          marketingOptIn: coupons30a || couponsDestin,
          next: nextField.value
        })
      }).then(function (response) {
        return response.json().then(function (body) { return { ok: response.ok, body: body }; });
      }).then(function (result) {
        if (!result.ok) {
          status.textContent = (result.body && result.body.error) || "The sign-in email could not be sent.";
          return;
        }
        status.textContent = "Check your email for a sign-in link. It expires in 20 minutes.";
        if (result.body && result.body.previewUrl) {
          var preview = document.createElement("a");
          preview.href = result.body.previewUrl;
          preview.textContent = "Open the sign-in link";
          status.appendChild(document.createTextNode(" "));
          status.appendChild(preview);
        }
      }).catch(function () {
        status.textContent = "The sign-in email could not be sent.";
      });
    });
  }

  function signOut() {
    fetch("/api/account/logout", { method: "POST", credentials: "same-origin" }).then(function () {
      refreshMe();
      location.href = "/account/?need=1";
    });
  }

  function mountPlaceCoupons(root) {
    var box = root.querySelector("[data-places-coupons]");
    var form = box && box.querySelector("[data-places-coupons-form]");
    if (!box || !form || form.getAttribute("data-bound") === "yes") return;
    form.setAttribute("data-bound", "yes");
    var note = form.querySelector("[data-coupons-status]");
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var coupons30a = form.coupons30a && form.coupons30a.checked === true;
      var couponsDestin = form.couponsDestin && form.couponsDestin.checked === true;
      if (note) note.textContent = "";
      if (!coupons30a && !couponsDestin) {
        if (note) note.textContent = "Choose at least one list.";
        return;
      }
      var button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      fetch("/api/account/coupons", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coupons30a: coupons30a, couponsDestin: couponsDestin })
      }).then(function (response) {
        if (response.status === 401) {
          location.href = "/account/?need=1&next=" + encodeURIComponent("/my-places/");
          return null;
        }
        return response.json().then(function (body) {
          return { ok: response.ok, body: body };
        }).catch(function () {
          return { ok: false, body: {} };
        });
      }).then(function (result) {
        if (!result) return;
        if (!result.ok) {
          if (note) note.textContent = (result.body && result.body.error) || "That signup could not be saved.";
          return;
        }
        form.reset();
        if (note) note.textContent = "Thanks. We have your signup.";
      }).catch(function () {
        if (note) note.textContent = "That signup could not be saved.";
      }).then(function () {
        if (button) button.disabled = false;
      });
    });
  }

  function mountPlaces(root) {
    var list = root.querySelector("[data-places]");
    var status = root.querySelector("[data-places-status]");
    mountPlaceCoupons(root);
    var kind = "favorite";
    var siteFilter = "all";
    var saves = [];
    var current = "";

    function render() {
      var shown = saves.filter(function (save) {
        if (save.kind !== kind) return false;
        if (siteFilter !== "all" && save.site !== siteFilter) return false;
        return true;
      });
      list.textContent = "";
      if (!shown.length) {
        var empty = document.createElement("p");
        empty.className = "place-empty";
        empty.textContent = emptyCopy(kind, siteFilter);
        list.appendChild(empty);
        return;
      }
      shown.forEach(function (save) {
        list.appendChild(card(save, current));
      });
    }

    function card(save, current) {
      var article = document.createElement("article");
      article.className = "place-card";
      var label = document.createElement("p");
      label.className = "place-site";
      label.textContent = LABELS[save.site] || save.site;
      var heading = document.createElement("h2");
      var link = document.createElement("a");
      link.href = placeHref(save, current);
      link.textContent = save.name;
      heading.appendChild(link);
      article.appendChild(label);
      article.appendChild(heading);
      if (save.area) {
        var area = document.createElement("p");
        area.className = "place-area";
        area.textContent = save.area;
        article.appendChild(area);
      }
      var noteWrap = document.createElement("div");
      noteWrap.className = "place-note";
      var noteLabel = document.createElement("p");
      noteLabel.className = "place-note-label";
      noteLabel.id = "note-label-" + save.site + "-" + save.kind + "-" + save.slug;
      noteLabel.textContent = "Your note";
      var view = document.createElement("p");
      view.className = "place-note-view";
      var empty = document.createElement("p");
      empty.className = "place-note-empty";
      empty.textContent = "Add a personal note...";
      var editor = document.createElement("textarea");
      editor.className = "place-note-input";
      editor.maxLength = 280;
      editor.rows = 3;
      editor.placeholder = "Add a personal note...";
      editor.setAttribute("aria-labelledby", noteLabel.id);
      var actions = document.createElement("div");
      actions.className = "note-actions";
      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "button secondary";
      var saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "button";
      saveBtn.textContent = "Save note";
      var cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "button secondary";
      cancelBtn.textContent = "Cancel";
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "button secondary place-remove";
      remove.textContent = "Remove";
      var editing = false;

      function paint() {
        var text = save.note || "";
        var has = text.trim().length > 0;
        view.textContent = text;
        view.hidden = editing || !has;
        empty.hidden = editing || has;
        editor.hidden = !editing;
        if (!editing) editor.value = text;
        editBtn.hidden = editing;
        editBtn.textContent = has ? "Edit note" : "Add note";
        saveBtn.hidden = !editing;
        cancelBtn.hidden = !editing;
      }

      editBtn.addEventListener("click", function () {
        editing = true;
        editor.value = save.note || "";
        paint();
        editor.focus();
      });
      cancelBtn.addEventListener("click", function () {
        editing = false;
        status.textContent = "";
        paint();
      });
      saveBtn.addEventListener("click", function () {
        var text = editor.value;
        if (text.length > 280) {
          status.textContent = "Keep the note under 280 characters.";
          return;
        }
        status.textContent = "";
        saveBtn.disabled = true;
        putSave({
          slug: save.slug,
          name: save.name,
          area: save.area,
          kind: save.kind,
          site: save.site,
          saved: true,
          note: text
        }).then(function (result) {
          saveBtn.disabled = false;
          if (!result) return;
          if (!result.ok) {
            status.textContent = (result.body && result.body.error) || "That note could not be saved.";
            return;
          }
          var nextNote = result.body && typeof result.body.note === "string" ? result.body.note : text.trim();
          saves.forEach(function (item) {
            if (item.site === save.site && item.slug === save.slug) item.note = nextNote;
          });
          status.textContent = nextNote ? "Note saved." : "Note cleared.";
          render();
        }).catch(function () {
          saveBtn.disabled = false;
          status.textContent = "That note could not be saved.";
        });
      });
      remove.addEventListener("click", function () {
        putSave({
          slug: save.slug,
          name: save.name,
          area: save.area,
          kind: save.kind,
          site: save.site,
          saved: false
        }).then(function (result) {
          if (!result || !result.ok) throw new Error("remove");
          saves = saves.filter(function (item) {
            return !(item.site === save.site && item.slug === save.slug && item.kind === save.kind);
          });
          status.textContent = "";
          render();
        }).catch(function () {
          status.textContent = "That place could not be removed.";
        });
      });

      actions.appendChild(editBtn);
      actions.appendChild(saveBtn);
      actions.appendChild(cancelBtn);
      actions.appendChild(remove);
      noteWrap.appendChild(noteLabel);
      noteWrap.appendChild(view);
      noteWrap.appendChild(empty);
      noteWrap.appendChild(editor);
      noteWrap.appendChild(actions);
      paint();
      article.appendChild(noteWrap);
      return article;
    }

    root.querySelectorAll("[data-tab]").forEach(function (tab) {
      tab.addEventListener("click", function () {
        kind = tab.getAttribute("data-tab");
        status.textContent = "";
        root.querySelectorAll("[data-tab]").forEach(function (item) {
          item.setAttribute("aria-selected", item === tab ? "true" : "false");
        });
        render();
      });
    });
    root.querySelectorAll("[data-site-filter]").forEach(function (button) {
      button.addEventListener("click", function () {
        siteFilter = button.getAttribute("data-site-filter");
        status.textContent = "";
        root.querySelectorAll("[data-site-filter]").forEach(function (item) {
          item.setAttribute("aria-pressed", item === button ? "true" : "false");
        });
        render();
      });
    });

    Promise.all([me(), config()]).then(function (parts) {
      var payload = parts[0];
      var cfg = parts[1];
      current = (cfg && cfg.site) || "";
      if (!payload || !payload.user) {
        if (queryParam("need") !== "1" && continueSignIn(cfg, "/my-places/")) return;
        showSignedOut();
        return;
      }
      var coupons = root.querySelector("[data-places-coupons]");
      if (coupons) coupons.hidden = false;
      fetch("/api/account/saves", { credentials: "same-origin" })
        .then(function (response) { return response.json(); })
        .then(function (body) {
          saves = (body && body.saves) || [];
          render();
        })
        .catch(function () {
          status.textContent = "Your places could not be loaded.";
        });
    });

    function showSignedOut() {
      status.textContent = "";
      var prompt = document.createElement("p");
      var link = document.createElement("a");
      link.className = "button";
      link.href = "/account/?need=1&next=" + encodeURIComponent("/my-places/");
      link.textContent = "Sign in";
      prompt.appendChild(link);
      list.textContent = "";
      list.appendChild(prompt);
    }
  }

  function emptyCopy(kind, site) {
    var noun = kind === "favorite" ? "favorites" : "places to try";
    if (site === "30a") return "No " + noun + " from 30A yet.";
    if (site === "destin") return "No " + noun + " from Destin yet.";
    if (kind === "favorite") return "No favorites yet. Use the heart on a listing to save one.";
    return "Nothing saved to try yet. Use Want to try on a listing.";
  }

  function boot() {
    refreshNav();
    mountSaves();
    mountCardSaves(document);
    watchMapList();
    var page = document.querySelector("[data-account-page]");
    if (!page) return;
    if (page.getAttribute("data-account-page") === "signin") mountSignIn(page);
    if (page.getAttribute("data-account-page") === "places") mountPlaces(page);
  }

  document.addEventListener("site-header-ready", refreshNav);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

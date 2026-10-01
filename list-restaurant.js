(function () {
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var URL = /^https?:\/\/\S+$/i;
  var DAYS = [
    ["mon", "Monday"],
    ["tue", "Tuesday"],
    ["wed", "Wednesday"],
    ["thu", "Thursday"],
    ["fri", "Friday"],
    ["sat", "Saturday"],
    ["sun", "Sunday"],
  ];
  var AMENITIES = [
    ["outdoor", "outdoor dining"],
    ["happyDrinks", "happy hour (drinks)"],
    ["happyFood", "happy hour (food)"],
    ["reservations", "reservations"],
    ["kids", "kid friendly"],
    ["groups", "groups of 12+"],
    ["music", "live music"],
  ];
  var URL_FIELDS = [
    ["website", "website"],
    ["facebook", "Facebook URL"],
    ["instagram", "Instagram URL"],
    ["logoUrl", "logo URL"],
    ["listPhotoUrl", "list photo URL"],
    ["detailPhotoUrl", "detail photo URL"],
    ["videoUrl", "video URL"],
  ];

  function status(form, message, isError) {
    var node = form.querySelector(".listing-status");
    if (!node) return;
    node.textContent = message;
    node.classList.toggle("is-error", Boolean(isError));
  }

  function queryValue(params, key, max) {
    var raw = params.get(key);
    if (!raw) return "";
    return raw.replace(/\s+/g, " ").trim().slice(0, max);
  }

  function selected(form, name) {
    var nodes = form.querySelectorAll('input[name="' + name + '"]:checked');
    return Array.prototype.map.call(nodes, function (node) {
      return node.value;
    });
  }

  function radio(form, name) {
    var node = form.querySelector('input[name="' + name + '"]:checked');
    return node ? node.value : "";
  }

  function text(form, name) {
    var node = form.querySelector('[name="' + name + '"]');
    return node ? String(node.value || "").trim() : "";
  }

  function phoneOk(value) {
    var digits = value.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15 && /^[0-9+().\-\s]+$/.test(value);
  }

  function syncIntent(form) {
    var update = radio(form, "intent") === "update";
    var field = form.querySelector('[name="existing"]');
    if (field) field.required = update;
  }

  function prefill(form) {
    var params = new URLSearchParams(window.location.search);
    var intent = queryValue(params, "intent", 20);
    var restaurant = queryValue(params, "restaurant", 160);
    var listing = queryValue(params, "listing", 300);
    var restaurantField = form.querySelector('[name="restaurant"]');
    var existingField = form.querySelector('[name="existing"]');
    var update = form.querySelector('input[name="intent"][value="update"]');
    if (restaurant && restaurantField && !String(restaurantField.value || "").trim()) {
      restaurantField.value = restaurant;
    }
    if ((intent === "update" || listing) && update) {
      update.checked = true;
      if (existingField && !String(existingField.value || "").trim()) {
        existingField.value = listing || restaurant;
      }
    }
    syncIntent(form);
  }

  function payload(form) {
    var body = {
      name: text(form, "name"),
      role: radio(form, "role"),
      email: text(form, "email"),
      yourPhone: text(form, "yourPhone"),
      bestTime: text(form, "bestTime"),
      intent: radio(form, "intent"),
      existing: text(form, "existing"),
      restaurant: text(form, "restaurant"),
      area: text(form, "area"),
      address: text(form, "address"),
      phone: text(form, "phone"),
      website: text(form, "website"),
      price: radio(form, "price"),
      description: text(form, "description"),
      seasonal: text(form, "seasonal"),
      cuisines: selected(form, "cuisines"),
      meals: selected(form, "meals"),
      foods: selected(form, "foods"),
      facebook: text(form, "facebook"),
      instagram: text(form, "instagram"),
      logoUrl: text(form, "logoUrl"),
      listPhotoUrl: text(form, "listPhotoUrl"),
      detailPhotoUrl: text(form, "detailPhotoUrl"),
      videoUrl: text(form, "videoUrl"),
      notes: text(form, "notes"),
      authorized: Boolean(form.querySelector('input[name="authorized"]:checked')),
      company: (form.querySelector('[name="company"]') || { value: "" }).value,
    };
    DAYS.forEach(function (day) {
      body[day[0]] = text(form, day[0]);
    });
    AMENITIES.forEach(function (item) {
      body[item[0]] = radio(form, item[0]);
    });
    return body;
  }

  function invalid(body) {
    if (!body.name || body.name.length > 120) return { message: "Enter your name.", field: "name" };
    if (body.role !== "owner" && body.role !== "manager" && body.role !== "marketing" && body.role !== "other") {
      return { message: "Choose owner, manager, marketing, or other.", field: "role" };
    }
    if (!EMAIL.test(body.email) || body.email.length > 200) return { message: "Enter a valid email.", field: "email" };
    if (body.yourPhone && !phoneOk(body.yourPhone)) return { message: "Enter a valid phone number.", field: "yourPhone" };
    if (body.bestTime.length > 120) return { message: "Keep the best time under 120 characters.", field: "bestTime" };
    if (body.intent !== "new" && body.intent !== "update") {
      return { message: "Choose new listing or update an existing listing.", field: "intent" };
    }
    if (body.intent === "update" && !body.existing) {
      return { message: "Enter the current listing URL or restaurant name.", field: "existing" };
    }
    if (body.existing.length > 300) return { message: "Keep the current listing under 300 characters.", field: "existing" };
    if (!body.restaurant || body.restaurant.length > 160) return { message: "Enter the restaurant name.", field: "restaurant" };
    if (!body.area) return { message: "Choose an area.", field: "area" };
    if (!body.address || body.address.length > 200) return { message: "Enter the street address.", field: "address" };
    if (!body.phone || !phoneOk(body.phone)) return { message: "Enter the restaurant phone.", field: "phone" };
    if (body.price !== "$" && body.price !== "$$" && body.price !== "$$$" && body.price !== "$$$$") {
      return { message: "Choose a price range.", field: "price" };
    }
    if (!body.description) return { message: "Enter a short description.", field: "description" };
    if (body.description.length > 800) return { message: "Keep the description under 800 characters.", field: "description" };
    for (var index = 0; index < DAYS.length; index += 1) {
      if (!body[DAYS[index][0]]) return { message: "Enter hours for " + DAYS[index][1] + ".", field: DAYS[index][0] };
    }
    if (body.seasonal.length > 300) return { message: "Keep the seasonal note under 300 characters.", field: "seasonal" };
    if (!body.cuisines.length) return { message: "Choose at least one cuisine type.", field: "cuisines" };
    if (!body.meals.length) return { message: "Choose at least one meal.", field: "meals" };
    for (var amenity = 0; amenity < AMENITIES.length; amenity += 1) {
      if (body[AMENITIES[amenity][0]] !== "yes" && body[AMENITIES[amenity][0]] !== "no") {
        return { message: "Choose yes or no for " + AMENITIES[amenity][1] + ".", field: AMENITIES[amenity][0] };
      }
    }
    for (var urlIndex = 0; urlIndex < URL_FIELDS.length; urlIndex += 1) {
      var value = body[URL_FIELDS[urlIndex][0]];
      if (value && !URL.test(value)) {
        return { message: "Enter a full " + URL_FIELDS[urlIndex][1] + " starting with https://.", field: URL_FIELDS[urlIndex][0] };
      }
    }
    if (body.notes.length > 2000) return { message: "Keep the notes under 2,000 characters.", field: "notes" };
    if (!body.authorized) return { message: "Confirm you are authorized to submit this listing.", field: "authorized" };
    return null;
  }

  function bind(form) {
    prefill(form);
    form.querySelectorAll('input[name="intent"]').forEach(function (input) {
      input.addEventListener("change", function () {
        syncIntent(form);
      });
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var body = payload(form);
      var problem = invalid(body);
      if (problem) {
        status(form, problem.message, true);
        var field = form.querySelector('[name="' + problem.field + '"]');
        if (field) field.focus();
        return;
      }
      var button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      status(form, "Sending…", false);
      fetch("/api/list-restaurant", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      })
        .then(function (response) {
          return response.json().then(function (data) {
            return { ok: response.ok, data: data };
          }).catch(function () {
            return { ok: false, data: {} };
          });
        })
        .then(function (result) {
          if (!result.ok || !result.data.ok) {
            status(form, result.data.error || "The listing could not be sent. Try again in a moment.", true);
            return;
          }
          form.reset();
          syncIntent(form);
          status(form, "Thanks. We have your listing.", false);
        })
        .catch(function () {
          status(form, "The listing could not be sent. Try again in a moment.", true);
        })
        .then(function () {
          if (button) button.disabled = false;
        });
    });
  }

  document.querySelectorAll("form[data-list-restaurant]").forEach(bind);
})();

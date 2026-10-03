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
    ["videoUrl", "video URL"],
  ];
  var MAX_IMAGE_BYTES = 2 * 1024 * 1024;
  var MAX_IMAGE_TOTAL = 6 * 1024 * 1024;
  var MAX_IMAGES = 6;
  var IMAGE_TYPE_ERROR = "Use a JPEG, PNG, or WebP image.";
  var IMAGE_SIZE_ERROR = "Each image must be 2 MB or smaller.";
  var IMAGE_COUNT_ERROR = "Attach up to 6 images.";
  var IMAGE_TOTAL_ERROR = "Keep the images to 6 MB or less together.";

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
    if (body.role && body.role !== "owner" && body.role !== "manager" && body.role !== "marketing" && body.role !== "other") {
      return { message: "Choose owner, manager, marketing, or other.", field: "role" };
    }
    if (!EMAIL.test(body.email) || body.email.length > 200) return { message: "Enter a valid email.", field: "email" };
    if (body.yourPhone && !phoneOk(body.yourPhone)) return { message: "Enter a valid phone number.", field: "yourPhone" };
    if (body.bestTime.length > 120) return { message: "Keep the best time under 120 characters.", field: "bestTime" };
    if (body.intent && body.intent !== "new" && body.intent !== "update") {
      return { message: "Choose new listing or update an existing listing.", field: "intent" };
    }
    if (body.existing.length > 300) return { message: "Keep the current listing under 300 characters.", field: "existing" };
    if (body.restaurant.length > 160) return { message: "Keep the restaurant name under 160 characters.", field: "restaurant" };
    if (body.address.length > 200) return { message: "Keep the street address under 200 characters.", field: "address" };
    if (body.phone && !phoneOk(body.phone)) return { message: "Enter a valid restaurant phone.", field: "phone" };
    if (body.price && body.price !== "$" && body.price !== "$$" && body.price !== "$$$" && body.price !== "$$$$") {
      return { message: "Choose a price range.", field: "price" };
    }
    if (body.description.length > 800) return { message: "Keep the description under 800 characters.", field: "description" };
    if (body.seasonal.length > 300) return { message: "Keep the seasonal note under 300 characters.", field: "seasonal" };
    for (var urlIndex = 0; urlIndex < URL_FIELDS.length; urlIndex += 1) {
      var value = body[URL_FIELDS[urlIndex][0]];
      if (value && !URL.test(value)) {
        return { message: "Enter a full " + URL_FIELDS[urlIndex][1] + " starting with https://.", field: URL_FIELDS[urlIndex][0] };
      }
    }
    if (body.notes.length > 2000) return { message: "Keep the notes under 2,000 characters.", field: "notes" };
    return null;
  }

  function sniffImage(bytes) {
    var view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (view.length >= 3 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) return "image/jpeg";
    if (
      view.length >= 8 &&
      view[0] === 0x89 &&
      view[1] === 0x50 &&
      view[2] === 0x4e &&
      view[3] === 0x47 &&
      view[4] === 0x0d &&
      view[5] === 0x0a &&
      view[6] === 0x1a &&
      view[7] === 0x0a
    ) return "image/png";
    if (
      view.length >= 12 &&
      view[0] === 0x52 &&
      view[1] === 0x49 &&
      view[2] === 0x46 &&
      view[3] === 0x46 &&
      view[8] === 0x57 &&
      view[9] === 0x45 &&
      view[10] === 0x42 &&
      view[11] === 0x50
    ) return "image/webp";
    return "";
  }

  function fileLabel(file) {
    var name = String((file && file.name) || "").replace(/\s+/g, " ").trim().slice(0, 80);
    return name || "That image";
  }

  function bindUploads(form) {
    var root = form.querySelector("[data-uploads]");
    var input = root && root.querySelector('input[type="file"]');
    var list = root && root.querySelector("[data-file-names]");
    var zone = root && root.querySelector(".listing-drop");
    if (!root || !input || !list || !zone) return { files: function () { return []; }, ready: function () { return Promise.resolve(); }, clear: function () {} };
    var chosen = [];
    var depth = 0;
    var ready = Promise.resolve();

    function render() {
      list.replaceChildren();
      chosen.forEach(function (item, index) {
        var row = document.createElement("li");
        var name = document.createElement("span");
        name.textContent = item.file.name || "Image";
        var remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.addEventListener("click", function () {
          chosen.splice(index, 1);
          render();
        });
        row.append(name, remove);
        list.append(row);
      });
    }

    function sameFile(left, right) {
      return left.name === right.name && left.size === right.size && left.lastModified === right.lastModified;
    }

    function take(fileList) {
      var incoming = Array.prototype.filter.call(fileList || [], function (file) {
        return file && file.size;
      });
      var problems = [];
      var chain = Promise.resolve();
      incoming.forEach(function (file) {
        chain = chain.then(function () {
          if (chosen.some(function (item) { return sameFile(item.file, file); })) return null;
          return file.slice(0, 16).arrayBuffer().then(function (buffer) {
            if (!sniffImage(buffer)) {
              problems.push(fileLabel(file) + ": " + IMAGE_TYPE_ERROR);
              return;
            }
            if (file.size > MAX_IMAGE_BYTES) {
              problems.push(fileLabel(file) + ": " + IMAGE_SIZE_ERROR);
              return;
            }
            if (chosen.length >= MAX_IMAGES) {
              problems.push(IMAGE_COUNT_ERROR);
              return;
            }
            var total = chosen.reduce(function (sum, item) { return sum + item.file.size; }, 0) + file.size;
            if (total > MAX_IMAGE_TOTAL) {
              problems.push(IMAGE_TOTAL_ERROR);
              return;
            }
            chosen.push({ file: file });
          }).catch(function () {
            problems.push(fileLabel(file) + ": " + IMAGE_TYPE_ERROR);
          });
        });
      });
      return chain.then(function () {
        render();
        if (problems.length) status(form, problems[0], true);
        else if (form.querySelector(".listing-status.is-error")) status(form, "", false);
      });
    }

    function enqueue(fileList) {
      ready = ready.then(function () { return take(fileList); });
      return ready;
    }

    input.addEventListener("change", function () {
      enqueue(input.files);
    });
    ["dragenter", "dragover"].forEach(function (type) {
      zone.addEventListener(type, function (event) {
        event.preventDefault();
        if (type === "dragenter") depth += 1;
        zone.classList.add("is-over");
      });
    });
    zone.addEventListener("dragleave", function () {
      depth -= 1;
      if (depth <= 0) {
        depth = 0;
        zone.classList.remove("is-over");
      }
    });
    zone.addEventListener("drop", function (event) {
      event.preventDefault();
      depth = 0;
      zone.classList.remove("is-over");
      enqueue(event.dataTransfer && event.dataTransfer.files);
    });

    return {
      files: function () { return chosen.map(function (item) { return item.file; }); },
      ready: function () { return ready; },
      clear: function () {
        chosen = [];
        render();
      },
    };
  }

  function filesProblem(files) {
    if (files.length > MAX_IMAGES) return IMAGE_COUNT_ERROR;
    var total = 0;
    for (var index = 0; index < files.length; index += 1) {
      var file = files[index];
      if (file.size > MAX_IMAGE_BYTES) return fileLabel(file) + ": " + IMAGE_SIZE_ERROR;
      total += file.size;
    }
    if (total > MAX_IMAGE_TOTAL) return IMAGE_TOTAL_ERROR;
    return "";
  }

  function bind(form) {
    var uploads = bindUploads(form);
    prefill(form);
    var sending = false;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      uploads.ready().then(function () {
        if (sending) return;
        var body = payload(form);
        var problem = invalid(body);
        var images = uploads.files();
        var imageProblem = filesProblem(images);
        if (problem || imageProblem) {
          status(form, problem ? problem.message : imageProblem, true);
          var field = problem
            ? form.querySelector('[name="' + problem.field + '"]')
            : form.querySelector('input[type="file"]');
          if (field) field.focus();
          return;
        }
        var data = new FormData(form);
        data.delete("photos");
        images.forEach(function (file) {
          data.append("photos", file, file.name);
        });
        var button = form.querySelector('button[type="submit"]');
        sending = true;
        if (button) button.disabled = true;
        status(form, "Sending…", false);
        fetch("/api/list-restaurant", {
          method: "POST",
          headers: { accept: "application/json" },
          body: data,
        })
          .then(function (response) {
            return response.json().then(function (payloadData) {
              return { ok: response.ok, data: payloadData };
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
            uploads.clear();
            status(form, "Thanks. We have your listing.", false);
          })
          .catch(function () {
            status(form, "The listing could not be sent. Try again in a moment.", true);
          })
          .then(function () {
            sending = false;
            if (button) button.disabled = false;
          });
      });
    });
  }

  document.querySelectorAll("form[data-list-restaurant]").forEach(bind);
})();

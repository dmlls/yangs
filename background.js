/* Copyright (C) 2023-2024 Diego Miguel Lozano <hello@diegomiguel.me>
 *
 * This program is free software: you can redistribute it and//or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * For license information on the libraries used, see LICENSE.
 */

import { PreferencePrefix, getBangKey } from "./utils.js";

// Support for Chrome.
if (typeof browser === "undefined") {
  globalThis.browser = chrome;
}

const bangs = {};
let bangSymbol = "!";

// Fetch Bangs from DuckDuckGo and load custom Bangs.
(async () => {
  let res;
  let defaultBangs = [];
  try {
    res = await fetch(
      new Request(
        "https://raw.githubusercontent.com/kagisearch/bangs/main/data/bangs.json",
      ),
    );
    defaultBangs = await res.json();
  } catch (error) {
    // Fallback to DDG bangs.
    console.warn(
      `Error fetching Kagi Bangs (${error.message}). Falling back to DuckDuckGo Bangs.`,
    );
    res = await fetch(new Request("https://duckduckgo.com/bang.js"));
    defaultBangs = await res.json();
  }
  for (const bang of defaultBangs) {
    bangs[bang.t] = {
      url: bang.u,
      urlEncodeQuery: true, // default value
      openBaseUrl: true, // default value
    };
  }
  // Exceptions (unfortunately, default bangs do not expose this info).
  bangs.wayback.urlEncodeQuery = false;
  bangs.waybackmachine.urlEncodeQuery = false;
  // Add custom bangs.
  await browser.storage.sync.get().then(
    function onGot(preferences) {
      Object.entries(preferences).forEach(([prefKey, pref]) => {
        if (prefKey.startsWith(PreferencePrefix.BANG)) {
          bangs[pref.bang] = {
            url: pref.url,
            urlEncodeQuery: pref.urlEncodeQuery,
            openBaseUrl: pref?.openBaseUrl ?? false,
          };
        } else if (prefKey.startsWith(PreferencePrefix.BANG_SYMBOL)) {
          bangSymbol = pref;
        }
      });
    },
    function onError(error) {
      // TODO: Handle errors.
    },
  );
})();

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = new URL(details.url);
    // Skip requests for suggestions.
    const skip =
      [
        "/ac",
        "suggest",
        "/complete",
        "/autocompleter",
        "/autocomplete",
        "/sugrec",
      ].some((path) => url.pathname.includes(path)) ||
      url.searchParams.get("mod") === "1"; // hack for Baidu
    if (skip) {
      return null;
    }
    // Different search engines use different params for the query.
    const params = ["q", "p", "query", "text", "eingabe", "wd"]
      .reduce((acc, param) => {
        let q = url.searchParams.get(param);
        // Some search engines include the query in the request body.
        if (!q) {
          const form = details?.requestBody?.formData;
          if (form != null && Object.prototype.hasOwnProperty.call(form, param))
            q = details?.requestBody?.formData[param][0];
        }
        if (q != null) {
          acc.push(q);
        }
        return acc;
      }, [])
      .filter((a) => a);

    if (params[0] === undefined) {
      return null;
    }
    let bang = "";
    let query = "";
    const searchTerms = params[0].split(" ");
    if (searchTerms) {
      const firstTerm = searchTerms[0].trim();
      const lastTerm = searchTerms[searchTerms.length - 1].trim();
      if (firstTerm.startsWith(bangSymbol)) {
        bang = firstTerm.substring(bangSymbol.length);
        query = searchTerms.slice(1).join(" ");
      } else if (lastTerm.startsWith(bangSymbol)) {
        bang = lastTerm.substring(bangSymbol.length);
        query = searchTerms.slice(0, -1).join(" ");
      } else {
        return null;
      }
    }
    bang = bang.toLowerCase();
    if (Object.hasOwn(bangs, bang)) {
      const bangUrl = bangs[bang].url;
      let targetUrl = "";
      if (query.length === 0 && bangs[bang].openBaseUrl) {
        targetUrl = new URL(bangUrl).origin;
      } else {
        if (bangs[bang].urlEncodeQuery) {
          query = encodeURIComponent(query);
        }
        targetUrl = new URL(bangUrl.replace("{{{s}}}", query));
      }
      updateTab(details.tabId, targetUrl.toString());
    }
    return null;
  },
  {
    urls: ["<all_urls>"],
  },
  ["blocking", "requestBody"],
);

function updateTab(tabId, url) {
  const updateProperties = { url };
  if (tabId != null) {
    chrome.tabs.update(tabId, updateProperties);
  } else {
    chrome.tabs.update(updateProperties);
  }
}

browser.action.onClicked.addListener(() => {
  browser.tabs.create({
    url: browser.runtime.getURL("options/options.html"),
  });
});

// Update custom bangs and settings.
function updateSettings(changes) {
  for (const changedKey of Object.keys(changes)) {
    if (changedKey.startsWith(PreferencePrefix.BANG)) {
      const changedValue = changes[changedKey];
      if (Object.hasOwn(changedValue, "newValue")) {
        bangs[changedValue.newValue.bang] = changedValue.newValue;
      } else if (Object.hasOwn(changedValue, "oldValue")) {
        // Removed bang.
        delete bangs[changedValue.oldValue.bang];
      }
    } else if (changedKey.startsWith(PreferencePrefix.BANG_SYMBOL)) {
      const changedValue = changes[changedKey];
      if (Object.hasOwn(changedValue, "newValue")) {
        bangSymbol = changedValue.newValue;
      }
    }
  }
}
browser.storage.sync.onChanged.addListener(updateSettings);

// Temporal function to migrate storage schema.
async function updateStorageSchema() {
  const customBangs = await browser.storage.sync.get();
  if (Object.keys(customBangs).length > 0) {
    const sortedBangs = Object.fromEntries(
      Object.entries(customBangs)
        .sort(([, a], [, b]) => a.order - b.order)
        .map(([bangKey, bang], index) => {
          if (
            !bangKey.startsWith(PreferencePrefix.BANG) &&
            !bangKey.startsWith(PreferencePrefix.BANG_SYMBOL) &&
            !bangKey.startsWith(PreferencePrefix.SEARCH_ENGINE)
          ) {
            bangKey = getBangKey(bang.bang);
          }
          if (
            !bangKey.startsWith(PreferencePrefix.BANG_SYMBOL) &&
            !bangKey.startsWith(PreferencePrefix.SEARCH_ENGINE)
          ) {
            bang.order = index;
          }
          return [bangKey, bang];
        }),
    );
    if (!customBangs.hasOwnProperty(PreferencePrefix.BANG_SYMBOL)) {
      customBangs[PreferencePrefix.BANG_SYMBOL] = "!";
    }
    await browser.storage.sync.clear().then(
      async function onCleared() {
        await browser.storage.sync.set(sortedBangs).then(
          function onSet() {
            // Success
          },
          async function onError(error) {
            await browser.storage.sync.set(sortedBangs); // Retry
          },
        );
      },
      function onError(error) {
        // TODO: Handle errors.
      },
    );
  }
}

browser.runtime.onInstalled.addListener(async ({ reason, temporary }) => {
  // if (temporary) return; // skip during development
  switch (reason) {
    case "update":
      updateStorageSchema();
      break;
    default:
      break;
  }
});

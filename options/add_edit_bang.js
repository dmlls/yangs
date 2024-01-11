const FormFields = Object.freeze({
    NAME: "name",
    URL: "url",
    BANG: "bang",
    URL_ENCODE_QUERY: "urlEncodeQuery"
});

function showErrorMessage(inputField, message) {
    let errorMsg = document.getElementById(`error-${inputField.id}`);
    errorMsg.textContent = message;
    errorMsg.style.visibility = "visible";
    inputField.classList.add("error-input-border");
}

function hideErrorMessage(inputField) {
    let errorMsg = document.getElementById(`error-${inputField.id}`);
    inputField.classList.remove("error-input-border");
    errorMsg.style.visibility = "hidden";
}

function validateEmpty(inputElement) {
    let textValue = inputElement.value.trim();
    if (textValue === "") {
        showErrorMessage(inputElement, "This field cannot be empty.");
        return;
    } else {
        hideErrorMessage(inputElement);
        return textValue.trim();
    }
}

function validateUrl(inputElement) {
    let url;
    let urlString = inputElement.value.trim();
    try {
        url = decodeURIComponent(new URL(urlString));
    } catch (_) {
        showErrorMessage(inputElement, "Invalid URL (don't forget to include the scheme, e.g., 'https://').");
        return;
    }
    // Valid.
    hideErrorMessage(inputElement);
    return url;
}

async function validateDuplicatedBang(inputElement) {
    let bang = inputElement.value.trim();
    valid = await browser.storage.sync.get(bang).then(
        function onGot(item) {
            if (Object.keys(item).length > 0) {
                showErrorMessage(inputElement, "Bang already exists.");
                return false;
            } else {
                hideErrorMessage(inputElement);
                return true;
            }
        },
        function onError(error) {
            // TODO: Handle error.
        }
    );
    return valid;
}

function getInputValue(inputId) {
    let value;
    let inputElement = document.getElementById(inputId);
    switch (inputElement.type) {
        case "text":
            switch(inputId) {
                case FormFields.NAME:
                    value = validateEmpty(inputElement);
                    break;
                case FormFields.URL:
                    value = validateEmpty(inputElement);
                    if (value !== undefined) {
                        value = validateUrl(inputElement);
                    }
                    break;
                case FormFields.BANG:
                    value = validateEmpty(inputElement);
                    // Remove leading or trailing "!".
                    value = stripExclamation(value);
                    break;
            }
            break;
        case "checkbox":
            value = inputElement.checked;
            break;
    }
    return value;
}

function getInputtedBang(last, mode) {
    let newBang = {};
    const inputIds = Object.values(FormFields);
    const inputtedValues = inputIds.map(inputId => getInputValue(inputId));
    for (var i = 0; i < inputIds.length; i++) {
        newBang[inputIds[i]] = inputtedValues[i];
    }
    newBang.order = (mode === "add") ? last + 1 : last;
    return newBang;
}

function isInputtedBangValid(bang) {
    return !Object.values(bang).includes(undefined);
}

function stripExclamation(string) {
    return string.replace(/^!+|!+$/g, "");
}

function setItem() {
    window.location.replace("options.html");
}

function onError() {}

async function saveCustomBang() {
    let saveButton = document.getElementById("save");
    const customBang = getInputtedBang(saveButton.last, saveButton.mode);
    let validBang;
    let bangElement = document.getElementById(FormFields.BANG);
    switch (saveButton.mode) {
        case "add":
            validBang = await validateDuplicatedBang(bangElement);
            break;
        case "edit":
            if (saveButton.bangName !== customBang.bang) {
                validBang = await validateDuplicatedBang(bangElement);
                // If the bang has changed and does not already exist ->
                // Delete the previous one.
                if (validBang) {
                    validBang = await browser.storage.sync.remove(saveButton.bangName).then(
                        function onRemoved() {
                            return true;
                        },
                        function onError() {
                            // TODO: Handle errors.
                        }
                    )
                }
            } else {
                validBang = true;
            }
    }
    if (isInputtedBangValid(customBang) && validBang) {
        browser.storage.sync.set({ [customBang.bang]: customBang }).then(setItem, onError);
    }
}

let saveButton = document.getElementById("save");
const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get("mode");
let last = Number(urlParams.get("last"));
let bangName;
if (mode === "edit") {
    let title = document.getElementById("title");
    title.innerHTML = "Edit Custom Bang";
    document.title = "Yang! – Edit Bang";
    bangName = stripExclamation(urlParams.get("bang"));
    browser.storage.sync.get(bangName).then(
        function onGot(item) {
            let bang = item[bangName];
            for (const field of Object.values(FormFields)) {
                let inputElement = document.getElementById(field);
                switch (inputElement.type) {
                    case "text":
                        inputElement.value = bang[field];
                        break;
                    case "checkbox":
                        inputElement.checked = bang[field];
                        break;
                }
            }
        },
        function onError(error) {
            // TODO: Handle error.
        }
    );
}
saveButton.mode = mode;
saveButton.last = last;
saveButton.bangName = bangName;
saveButton.addEventListener("click", saveCustomBang, false);

// Save with Ctrl+Enter or Cmd+Enter.
let inputFields = document.getElementsByClassName("input-field");
for (let field of inputFields) {
    field.onkeydown = (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.keyCode == 13 || e.keyCode == 10)) {
            saveCustomBang();
        }
    }
}

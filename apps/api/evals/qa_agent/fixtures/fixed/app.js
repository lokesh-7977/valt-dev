// Demo signup form for the Sentinel live QA agent.
// No network calls: "creating" an account only shows a message.

function validate(email, password) {
  const errors = [];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Enter a valid email address");
  }
  if (!password) errors.push("Password is required");
  else if (password.length < 8) errors.push("Password must be at least 8 characters");
  return errors;
}

document.getElementById("signup").addEventListener("submit", (event) => {
  event.preventDefault();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const errorsEl = document.getElementById("errors");
  const resultEl = document.getElementById("result");

  const errors = validate(email, password);
  errorsEl.textContent = errors.join(". ");
  resultEl.textContent = errors.length === 0 ? "Account created!" : "";
});

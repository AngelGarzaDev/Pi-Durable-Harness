// Sends the access token once; the server answers with an HttpOnly session cookie.
const msg = document.getElementById("msg");
document.getElementById("f").onsubmit = async (e) => {
	e.preventDefault();
	const token = document.getElementById("token");
	msg.className = "";
	msg.textContent = "Signing in…";
	const res = await fetch("/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: token.value }) });
	token.value = "";
	if (res.ok) {
		location.href = "/";
	} else {
		msg.className = "error";
		msg.textContent = res.status === 401 ? "Wrong token." : res.status === 429 ? "Too many wrong attempts. Wait 15 minutes and try again." : "Sign-in failed.";
	}
};

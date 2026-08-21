export async function login(client) {
  const url =
    `${client.baseUrl}/Kingdee.BOS.WebApi.ServicesStub.AuthService.ValidateUser.common.kdsvc`;

  const payload = {
    acctID: client.erpAccount,
    username: client.username,
    password: client.password,
    lcid: client.languageId,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    redirect: "follow",
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Kingdee login failed. HTTP ${response.status}: ${responseText}`
    );
  }

  let result;

  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error("Unable to parse Kingdee login response.");
  }

  if (
    result.LoginResultType !== 1 &&
    result.LoginResultType !== "1"
  ) {
    throw new Error(
      result.Message ||
      result.message ||
      "Kingdee login failed."
    );
  }

  const setCookie = response.headers.get("set-cookie");

  if (!setCookie) {
    throw new Error(
      "Kingdee login succeeded, but no session cookie was returned."
    );
  }

  const cookie = setCookie
    .split(",")
    .map((item) => item.split(";")[0].trim())
    .join("; ");

  client.cookie = cookie;

  return {
    cookie,
    response: result,
  };
}
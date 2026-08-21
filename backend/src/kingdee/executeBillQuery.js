export function buildQuery({
  formId,
  fieldKeys,
  filterString = "",
  orderString = "",
  startRow = 0,
  limit = 500,
}) {
  const normalizedFormId = String(formId || "").trim();

  if (!normalizedFormId) {
    throw new Error("FormId is required.");
  }

  const normalizedFieldKeys = Array.isArray(fieldKeys)
    ? fieldKeys
        .map((field) => String(field || "").trim())
        .filter(Boolean)
        .join(",")
    : String(fieldKeys || "")
        .split(",")
        .map((field) => field.trim())
        .filter(Boolean)
        .join(",");

  if (!normalizedFieldKeys) {
    throw new Error(
      "At least one Kingdee field key is required."
    );
  }

  return {
    FormId: normalizedFormId,
    FieldKeys: normalizedFieldKeys,
    FilterString: String(filterString || "").trim(),
    OrderString: String(orderString || "").trim(),
    TopRowCount: 0,
    StartRow: Math.max(0, Number(startRow) || 0),
    Limit: Math.max(1, Number(limit) || 500),
  };
}

export async function executeBillQuery(client, query) {
  if (!client.cookie) {
    await client.login();
  }

  const endpoint =
    `${client.baseUrl}/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.ExecuteBillQuery.common.kdsvc`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Cookie: client.cookie,
    },
    body: JSON.stringify({
      data: query,
    }),
    redirect: "follow",
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Kingdee query failed. HTTP ${response.status}: ${responseText}`
    );
  }

  let result;

  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error(
      "Unable to parse Kingdee query response."
    );
  }

  // Handle Kingdee responses wrapped inside arrays.
  if (Array.isArray(result)) {
    const firstItem = Array.isArray(result[0])
      ? result[0][0]
      : result[0];

    if (
      firstItem?.Result?.ResponseStatus?.IsSuccess === false
    ) {
      const errors =
        firstItem.Result.ResponseStatus.Errors || [];

      const message = errors
        .map((error) => error.Message)
        .filter(Boolean)
        .join(" | ");

      throw new Error(
        message ||
        "Kingdee query returned an unsuccessful response."
      );
    }

    return result;
  }

  // Handle normal object-style Kingdee error responses.
  if (
    result?.Result?.ResponseStatus?.IsSuccess === false
  ) {
    const errors =
      result.Result.ResponseStatus.Errors || [];

    const message = errors
      .map((error) => error.Message)
      .filter(Boolean)
      .join(" | ");

    throw new Error(
      message ||
      "Kingdee query returned an unsuccessful response."
    );
  }

  // Handle other possible successful response wrappers.
  if (Array.isArray(result?.Result)) {
    return result.Result;
  }

  if (Array.isArray(result?.Result?.Result)) {
    return result.Result.Result;
  }

  if (Array.isArray(result?.Data)) {
    return result.Data;
  }

  if (Array.isArray(result?.data)) {
    return result.data;
  }

  throw new Error(
    `Unexpected Kingdee query response: ${responseText}`
  );
}
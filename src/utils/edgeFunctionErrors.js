/**
 * When `supabase.functions.invoke` gets a non-2xx response, `data` is null and `error` is a
 * `FunctionsHttpError` whose `.context` is the fetch `Response` — the JSON body must be read from it.
 */
export async function getEdgeFunctionInvokeFailureDetails(error, data) {
  if (data && typeof data === "object" && data.error != null) {
    return {
      message: String(data.error),
      preconditionFailed: Boolean(data.preconditionFailed),
    };
  }

  if (error?.name === "FunctionsHttpError" && error.context && typeof error.context.clone === "function") {
    try {
      const body = await error.context.clone().json();
      if (body && typeof body === "object") {
        if (body.error != null) {
          return {
            message: String(body.error),
            preconditionFailed: Boolean(body.preconditionFailed),
          };
        }
        if (typeof body.message === "string") {
          return { message: body.message, preconditionFailed: Boolean(body.preconditionFailed) };
        }
      }
    } catch {
      /* non-JSON or empty body */
    }
  }

  return {
    message: String(error?.message || "Request failed"),
    preconditionFailed: false,
  };
}

export async function getEdgeFunctionErrorMessage(error, data) {
  const d = await getEdgeFunctionInvokeFailureDetails(error, data);
  return d.message;
}

// The two Deno globals used by the edge entry points. No polyfill is shipped to the browser.
declare namespace Deno {
  const env: { get(name: string): string | undefined };
  function serve(handler: (request: Request) => Response | Promise<Response>): void;
}

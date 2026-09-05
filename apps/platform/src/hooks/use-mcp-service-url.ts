"use client";

import * as React from "react";

/**
 * 计算 MCP 服务 URL：优先 publicUrl，否则用浏览器当前 origin + path。
 * 客户端渲染后才有 window，故用 mount 后计算，避免 SSR/客户端水合不一致。
 */
export function useMcpServiceUrl(path: string, publicUrl: string): string {
  const [url, setUrl] = React.useState("");

  React.useEffect(() => {
    setUrl(publicUrl ? `${publicUrl}${path}` : `${window.location.origin}${path}`);
  }, [path, publicUrl]);

  return url;
}

export function mcpConfigSnippet(url: string): string {
  return `{
  "mcpServers": {
    "apigent": {
      "url": "${url}",
      "headers": { "Authorization": "Bearer <your-key>" }
    }
  }
}`;
}

export function curlSnippet(url: string): string {
  return `curl ${url}/v1/apis/search \\
  -H "Authorization: Bearer <your-key>" \\
  -H "Content-Type: application/json"`;
}

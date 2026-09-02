import { setDefaultResultOrder, resolve4 } from "node:dns";
import { lookup as dnsLookup } from "node:dns";
import { Agent, setGlobalDispatcher } from "undici";

/**
 * 出网设置。只在进程入口调一次，不在库代码里偷偷改全局。
 *
 * 三个实测出来的问题（2026-09-02，国内网络访问阿里百炼的 workspace 端点）：
 *
 * 1. **IPv6 完全不通，IPv4 通。** 该域名同时有 AAAA 和 A 记录，
 *    Node 默认按 DNS 顺序先试 IPv6，卡住之后 fetch 只抛一句 `fetch failed`。
 *
 * 2. **A 记录里有一个是死的。** 实测：
 *      101.201.58.201  TCP 290ms  TLS 596ms  通
 *      47.94.20.201    ETIMEDOUT 21s         死
 *    DNS 两个都返回，抽中死的就卡住。
 *
 * 3. 因此**加长连接超时是错的解法**，只会让它在死 IP 上等更久。
 *    正解是超时改短、DNS 顺序随机化、失败快速重试，让死 IP 快速出局。
 */
let applied = false;

/** 短。死 IP 要快速出局，重试会换一个地址 */
export const CONNECT_TIMEOUT_MS = 6_000;
export const HEADERS_TIMEOUT_MS = 120_000;
/** 流式多模态响应可能拖很久 */
export const BODY_TIMEOUT_MS = 300_000;

interface LookupEntry {
  address: string;
  family: number;
}

/**
 * 随机化 A 记录顺序的 lookup。
 *
 * Node 会按固定顺序依次尝试地址，死的排在前面就每次都先卡一轮。
 * 打乱之后配合短超时和重试，期望一两次就能撞上活的。
 * 不硬编码任何 IP：地址会变，硬编码就是埋雷。
 *
 * 注意 undici 是带 `all: true` 调用这个函数的，回调要给数组；
 * 而 dns.lookup 不带 all 时回调是 (err, address, family) 三个参数。
 * 两种都要支持，只按其中一种写会得到 `Invalid IP address: undefined`。
 */
function shuffledLookup(
  hostname: string,
  options: { all?: boolean } | undefined,
  callback: (err: NodeJS.ErrnoException | null, ...rest: unknown[]) => void,
): void {
  const wantsAll = options?.all === true;

  resolve4(hostname, (err, addresses) => {
    if (err || !addresses || addresses.length === 0) {
      // 解析不出来就退回系统解析，别把问题放大成完全不可用
      dnsLookup(hostname, { ...(options ?? {}), family: 4 } as never, callback as never);
      return;
    }

    const shuffled = [...addresses];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    if (wantsAll) {
      const all: LookupEntry[] = shuffled.map((address) => ({ address, family: 4 }));
      callback(null, all);
    } else {
      callback(null, shuffled[0], 4);
    }
  });
}

export function configureNetwork(): void {
  if (applied) return;
  applied = true;

  setDefaultResultOrder("ipv4first");

  setGlobalDispatcher(
    new Agent({
      connect: {
        timeout: CONNECT_TIMEOUT_MS,
        lookup: shuffledLookup as never,
      },
      headersTimeout: HEADERS_TIMEOUT_MS,
      bodyTimeout: BODY_TIMEOUT_MS,
    }),
  );
}

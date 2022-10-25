import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Metadata } from "@metaplex-foundation/mpl-token-metadata";
import { UnstakedData, checkCandyMachineStakable } from "../util/staking";

export const useUnstakedNfts = (refreshHandle?: any) => {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [nfts, setNfts] = useState<UnstakedData[]>([]);

  useEffect(() => {
    (async () => {
      if (!publicKey) return;

      const walletNfts = await Metadata.findDataByOwner(connection, publicKey);

      const nfts: UnstakedData[] = [];
      await Promise.all(
        walletNfts.map(async ({ mint, data }) => {
          if (
            data.creators &&
            data.creators[0]?.verified &&
            (await checkCandyMachineStakable(
              connection,
              data.creators[0].address
            ))
          )
            nfts.push({
              mint: new PublicKey(mint),
              data,
              json: await fetch(data.uri).then((e) => e.json()),
            });
        })
      );

      let collator = new Intl.Collator(undefined, { numeric: true });
      nfts.sort((a, b) => collator.compare(a.data.name, b.data.name));
      setNfts(nfts);
    })();
  }, [publicKey, connection, refreshHandle]);

  return nfts;
};

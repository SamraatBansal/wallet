import { useEffect, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { StakedData, getStakedDataByOwner } from "../util/staking";

export const useStakedNfts = (refreshHandle?: any) => {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [nfts, setNfts] = useState<StakedData[]>([]);

  useEffect(() => {
    (async () => {
      if (!publicKey) return;

      const stakedNfts = await getStakedDataByOwner(connection, publicKey);
      let collator = new Intl.Collator(undefined, { numeric: true });
      stakedNfts.sort((a, b) => collator.compare(a.data.name, b.data.name));
      setNfts(stakedNfts);
    })();
  }, [publicKey, connection, refreshHandle]);

  return nfts;
};

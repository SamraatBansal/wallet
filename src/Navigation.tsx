import React, { FC, useCallback, useEffect, useReducer, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  WalletDisconnectButton,
  WalletMultiButton,
} from "@solana/wallet-adapter-react-ui";

import { useStakedNfts } from "./hooks/useStakedNfts";
import { useUnstakedNfts } from "./hooks/useUnstakedNfts";

import { PublicKey } from "@solana/web3.js";
import {
  createStakeTokenTransaction,
  createUnstakeTokenTransaction,
  createWithdrawRewardTransaction,
  getRewardCalculator,
  calculateRewards,
  StakedData,
  UnstakedData,
  RewardCalculator,
} from "./util/staking";

export const Navigation: FC = () => {
  const { connection } = useConnection();
  const { wallet } = useWallet();

  const [refreshHandle, forceRefresh] = useReducer((x) => !x, true);
  const stakedNfts = useStakedNfts(refreshHandle);
  const unstakedNfts = useUnstakedNfts(refreshHandle);
  const [rewardCalculator, setRewardCalculator] =
    useState<RewardCalculator | null>(null);

  useEffect(() => {
    getRewardCalculator(connection).then((r) => setRewardCalculator(r));
  }, [connection]);

  return (
    <>
      <nav>
        <h1>Staking App</h1>
        <div>
          <WalletMultiButton />
          {wallet && <WalletDisconnectButton />}
        </div>
      </nav>

      <h2>Staked NFTs</h2>
      <section id="staked-nfts" className="card-grid">
        {stakedNfts.map((nft) => (
          <NFT
            key={nft.json.name}
            nft={nft}
            onChange={forceRefresh}
            staked={true}
            rewardCalculator={rewardCalculator}
          />
        ))}
      </section>

      <h2>Unstaked NFTs</h2>
      <section id="unstaked-nfts" className="card-grid">
        {unstakedNfts.map((nft) => (
          <NFT
            key={nft.json.name}
            nft={nft}
            onChange={forceRefresh}
            staked={false}
          />
        ))}
      </section>
    </>
  );
};

const NFT = ({
  nft,
  staked,
  onChange,
  rewardCalculator = null,
}: {
  nft: UnstakedData;
  staked: boolean;
  onChange?: () => any;
  rewardCalculator?: RewardCalculator | null;
}) => {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  const [rewardDate, setRewardDate] = useState<Date>(new Date());

  useEffect(() => {
    if (!rewardCalculator) return;
    let { rewardPeriod } = rewardCalculator;

    let interval = Number.MAX_SAFE_INTEGER;
    if (rewardPeriod < BigInt(Number.MAX_SAFE_INTEGER))
      interval = parseInt(rewardPeriod.toString()) * 1000;

    let id = setInterval(() => setRewardDate(new Date()), interval);
    return () => clearInterval(id);
  }, [rewardCalculator]);

  const sendAndConfirmTransaction = useCallback(
    async (transaction) => {
      let { blockhash } = await connection.getRecentBlockhash();
      transaction.feePayer = publicKey!;
      transaction.recentBlockhash = blockhash;

      let signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, "confirmed");

      console.log(signature);

      if (onChange) onChange();

      return signature;
    },
    [connection, publicKey, sendTransaction, onChange]
  );

  const stakeToken = useCallback(
    async (address: PublicKey) => {
      if (!publicKey) return;
      await sendAndConfirmTransaction(
        await createStakeTokenTransaction(connection, publicKey, address)
      );
    },
    [connection, publicKey, sendAndConfirmTransaction]
  );

  const unstakeToken = useCallback(
    async (address: PublicKey) => {
      if (!publicKey) return;
      await sendAndConfirmTransaction(
        await createUnstakeTokenTransaction(connection, publicKey, address)
      );
    },
    [connection, publicKey, sendAndConfirmTransaction]
  );

  const withdrawRewards = useCallback(
    async (address: PublicKey) => {
      if (!publicKey) return;
      await sendAndConfirmTransaction(
        await createWithdrawRewardTransaction(connection, publicKey, address)
      );
    },
    [connection, publicKey, sendAndConfirmTransaction]
  );

  return (
    <div className="card">
      <img src={nft.json.image} alt={nft.json.description} />
      <h3>{nft.data.name}</h3>
      {staked ? (
        <>
          <div>
            Reward:{" "}
            <span className="counter">
              {calculateRewards(
                nft as StakedData,
                rewardDate,
                rewardCalculator
              )}
            </span>{" "}
            coins
          </div>
          <button onClick={() => withdrawRewards(nft.mint)}>Withdraw</button>
          <button onClick={() => unstakeToken(nft.mint)}>Unstake</button>
        </>
      ) : (
        <button onClick={() => stakeToken(nft.mint)}>Stake</button>
      )}
    </div>
  );
};

import {
  AccountMeta,
  Connection,
  MemcmpFilter,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  Token,
} from "@solana/spl-token";
import {
  Metadata,
  MetadataDataData,
} from "@metaplex-foundation/mpl-token-metadata";
import * as bs58 from "bs58";
/* global BigInt */

export const PROGRAM_ID = new PublicKey(
  "JB4MhKZVMcjb8RXWEnfSY18xLc61Y4g5BB6EPyb499cf"
);
const REWARD_MINT = new PublicKey(
  "EmgXc8YBCUFFjwvNzXMbhm4Uob1xDBgosm3SQJQKe5t1"
);

let REWARD_MINT_DECIMALS = -1;
async function getRewardMintDecimals(connection: Connection): Promise<number> {
  if (REWARD_MINT_DECIMALS === -1) {
    let rewardMintInfo = await connection.getParsedAccountInfo(REWARD_MINT);
    let data = rewardMintInfo?.value?.data;
    if (data && !(data instanceof Buffer))
      REWARD_MINT_DECIMALS = data.parsed.info.decimals;
    else REWARD_MINT_DECIMALS = 9;
  }
  return REWARD_MINT_DECIMALS;
}

function createInstructionData(instruction: string): Buffer {
  if (instruction === "Stake") return Buffer.from([1]);
  else if (instruction === "Unstake") return Buffer.from([2]);
  else if (instruction === "StakeWithdraw") return Buffer.from([5]);

  throw new Error(`Unrecognized instruction: ${instruction}`);
}

function parseUint64Le(data: Uint8Array, offset: number = 0): bigint {
  let number = BigInt(0);
  for (let i = 0; i < 8; i++)
    number += BigInt(data[offset + i]) << BigInt(i * 8);
  return number;
}

function getAssociatedTokenAddress(
  walletAddress: PublicKey,
  tokenAddress: PublicKey,
  allowOffCurve: boolean = false
): Promise<PublicKey> {
  return Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    tokenAddress,
    walletAddress,
    allowOffCurve
  );
}

function transactionKey(
  pubkey: PublicKey,
  isSigner: boolean,
  isWritable: boolean = true
): AccountMeta {
  return {
    pubkey,
    isSigner,
    isWritable,
  };
}

const VAULT_PREFIX = "vault";
export async function getVaultAddress(): Promise<PublicKey> {
  let [address] = await PublicKey.findProgramAddress(
    [Buffer.from(VAULT_PREFIX)],
    PROGRAM_ID
  );
  return address;
}

export async function getStakeDataAddress(
  token: PublicKey
): Promise<PublicKey> {
  let [address] = await PublicKey.findProgramAddress(
    [token.toBytes()],
    PROGRAM_ID
  );
  return address;
}

export async function checkCandyMachineStakable(
  connection: Connection,
  candyMachine: string,
  forceRefresh: boolean = false
): Promise<boolean> {
  return (
    (await getCandyMachineRate(connection, candyMachine, forceRefresh)) != null
  );
}

const CANDY_MACHINE_RATE_CACHE = new Map<string, bigint | null>();
export async function getCandyMachineRate(
  connection: Connection,
  candyMachine: string,
  forceRefresh: boolean = false
): Promise<bigint | null> {
  if (forceRefresh || !CANDY_MACHINE_RATE_CACHE.has(candyMachine)) {
    let whitelistDataAddress = await getWhitelistDataAddress(
      new PublicKey(candyMachine)
    );

    let price = null;
    let whitelistData = await connection.getAccountInfo(whitelistDataAddress);
    if (whitelistData != null) price = parseUint64Le(whitelistData.data);

    CANDY_MACHINE_RATE_CACHE.set(candyMachine, price);
  }

  return CANDY_MACHINE_RATE_CACHE.get(candyMachine)!;
}

const WHITELIST_PREFIX = "whitelist";
export async function getWhitelistDataAddress(
  candyMachine: PublicKey
): Promise<PublicKey> {
  let [address] = await PublicKey.findProgramAddress(
    [Buffer.from(WHITELIST_PREFIX), candyMachine.toBytes()],
    PROGRAM_ID
  );
  return address;
}

export interface RewardCalculator {
  minPeriod: bigint;
  rewardPeriod: bigint;
}

export async function getRewardCalculator(
  connection: Connection
): Promise<RewardCalculator> {
  let vaultAddress = await getVaultAddress();
  let valutAccountInfo = await connection.getAccountInfo(vaultAddress);
  if (!valutAccountInfo) throw new Error(`${vaultAddress} not initialized`);
  let { data } = valutAccountInfo;

  return {
    minPeriod: parseUint64Le(data, 0),
    rewardPeriod: parseUint64Le(data, 8),
  };
}

export function calculateRewards(
  stakedData: StakedData,
  now: Date,
  rewardCalculator: RewardCalculator | null
) {
  if (!rewardCalculator) return "0";

  let nowTimestamp = BigInt(Math.floor(now.getTime() / 1000));
  let { timestamp, withdrawn, rewardMultiplier, decimals } = stakedData;
  let { minPeriod, rewardPeriod } = rewardCalculator;

  let period = nowTimestamp - timestamp;
  if (period < minPeriod) return "0";

  let reward = (rewardMultiplier * period) / rewardPeriod - withdrawn;
  return (reward / BigInt(10 ** decimals)).toString();
}

export interface UnstakedData {
  mint: PublicKey;
  data: MetadataDataData;
  json: any;
}
export interface StakedData extends UnstakedData {
  timestamp: bigint;
  withdrawn: bigint;
  rewardMultiplier: bigint;
  decimals: number;
}

export async function getStakedDataByOwner(
  connection: Connection,
  owner: PublicKey
): Promise<StakedData[]> {
  let stakeDataAccounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [
      createStakeTokenOwnerFilter(owner),
      createStakeTokenActiveFilter(),
    ],
  });

  return Promise.all(
    stakeDataAccounts.map(async ({ account: { data } }) => {
      let timestamp = parseUint64Le(data, 0);
      let mint = new PublicKey(data.slice(40, 72));
      let metadata = await Metadata.load(
        connection,
        await Metadata.getPDA(mint)
      );
      let json = await fetch(metadata.data.data.uri).then((e) => e.json());
      let withdrawn = parseUint64Le(data, 73);

      let candyMachineAddress = metadata.data.data.creators![0].address;
      let rewardMultiplier = await getCandyMachineRate(
        connection,
        candyMachineAddress
      );
      if (rewardMultiplier == null) {
        console.trace(
          `Warning: null rewardMultiplier for candy machine: ${candyMachineAddress}`
        );
        rewardMultiplier = BigInt(1);
      }
      let decimals = await getRewardMintDecimals(connection);

      return {
        mint,
        data: metadata.data.data,
        json,
        timestamp,
        withdrawn,
        rewardMultiplier,
        decimals,
      };
    })
  );
}

export function createStakeTokenOwnerFilter(owner: PublicKey): MemcmpFilter {
  return {
    memcmp: {
      offset: 8,
      bytes: owner.toBase58(),
    },
  };
}

export function createStakeTokenActiveFilter(
  active: boolean = true
): MemcmpFilter {
  return {
    memcmp: {
      offset: 72,
      bytes: bs58.encode([active ? 1 : 0]),
    },
  };
}

export async function createStakeTokenTransaction(
  connection: Connection,
  owner: PublicKey,
  token: PublicKey
): Promise<Transaction> {
  let metadata = await Metadata.load(connection, await Metadata.getPDA(token));
  let candyMachineAddress = metadata.data.data.creators![0].address;
  let candyMachine = new PublicKey(candyMachineAddress);

  let sourceTokenAccount = null;
  let { value: accounts } = await connection.getTokenLargestAccounts(token);
  for (let { address, amount } of accounts)
    if (amount === "1") sourceTokenAccount = address;
  if (!sourceTokenAccount)
    throw new Error(`Could not get current owner for ${token}`);

  let transaction = new Transaction();
  transaction.add(
    await createStakeTokenInstruction(
      owner,
      token,
      candyMachine,
      sourceTokenAccount
    )
  );

  let primarySourceTokenAccount = await getAssociatedTokenAddress(owner, token);
  if (!primarySourceTokenAccount.equals(sourceTokenAccount))
    transaction.add(
      Token.createCloseAccountInstruction(
        TOKEN_PROGRAM_ID,
        sourceTokenAccount,
        primarySourceTokenAccount,
        owner,
        []
      )
    );

  return transaction;
}
export async function createStakeTokenInstruction(
  owner: PublicKey,
  token: PublicKey,
  candyMachine: PublicKey,
  sourceTokenAccount?: PublicKey
): Promise<TransactionInstruction> {
  let vaultAddress = await getVaultAddress();
  let metadataAddress = await Metadata.getPDA(token);

  if (!sourceTokenAccount)
    sourceTokenAccount = await getAssociatedTokenAddress(owner, token);
  let destinationTokenAccount = await getAssociatedTokenAddress(
    vaultAddress,
    token,
    true
  );

  let stakeDataAddress = await getStakeDataAddress(token);
  let whitelistDataAddress = await getWhitelistDataAddress(candyMachine);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data: createInstructionData("Stake"),
    keys: [
      transactionKey(owner, true),
      transactionKey(token, false, false),
      transactionKey(metadataAddress, false, false),

      transactionKey(vaultAddress, false, false),
      transactionKey(sourceTokenAccount, false),
      transactionKey(destinationTokenAccount, false),

      transactionKey(TOKEN_PROGRAM_ID, false, false),
      transactionKey(SystemProgram.programId, false, false),
      transactionKey(SYSVAR_RENT_PUBKEY, false, false),
      transactionKey(ASSOCIATED_TOKEN_PROGRAM_ID, false, false),

      transactionKey(stakeDataAddress, false),
      transactionKey(whitelistDataAddress, false),
    ],
  });
}

export async function createUnstakeTokenTransaction(
  connection: Connection,
  owner: PublicKey,
  token: PublicKey
): Promise<Transaction> {
  let metadata = await Metadata.load(connection, await Metadata.getPDA(token));
  let candyMachineAddress = metadata.data.data.creators![0].address;
  let candyMachine = new PublicKey(candyMachineAddress);

  let transaction = new Transaction();
  transaction.add(
    await createUnstakeTokenInstruction(owner, token, candyMachine)
  );
  return transaction;
}
export async function createUnstakeTokenInstruction(
  owner: PublicKey,
  token: PublicKey,
  candyMachine: PublicKey
): Promise<TransactionInstruction> {
  let vaultAddress = await getVaultAddress();
  let metadataAddress = await Metadata.getPDA(token);

  let sourceTokenAccount = await getAssociatedTokenAddress(
    vaultAddress,
    token,
    true
  );
  let destinationTokenAccount = await getAssociatedTokenAddress(owner, token);

  let sourceRewardAccount = await getAssociatedTokenAddress(
    vaultAddress,
    REWARD_MINT,
    true
  );
  let destinationRewardAccount = await getAssociatedTokenAddress(
    owner,
    REWARD_MINT
  );

  let stakeDataAddress = await getStakeDataAddress(token);
  let whitelistDataAddress = await getWhitelistDataAddress(candyMachine);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data: createInstructionData("Unstake"),
    keys: [
      transactionKey(owner, true),
      transactionKey(SystemProgram.programId, false, false),
      transactionKey(token, false, false),

      transactionKey(TOKEN_PROGRAM_ID, false, false),
      transactionKey(SYSVAR_RENT_PUBKEY, false, false),
      transactionKey(ASSOCIATED_TOKEN_PROGRAM_ID, false, false),

      transactionKey(stakeDataAddress, false),
      transactionKey(vaultAddress, false, false),

      transactionKey(destinationRewardAccount, false),
      transactionKey(sourceRewardAccount, false),
      transactionKey(destinationTokenAccount, false),
      transactionKey(sourceTokenAccount, false),

      transactionKey(metadataAddress, false, false),
      transactionKey(whitelistDataAddress, false),

      transactionKey(REWARD_MINT, false, false),
    ],
  });
}

export async function createWithdrawRewardTransaction(
  connection: Connection,
  owner: PublicKey,
  token: PublicKey
): Promise<Transaction> {
  let metadata = await Metadata.load(connection, await Metadata.getPDA(token));
  let candyMachineAddress = metadata.data.data.creators![0].address;
  let candyMachine = new PublicKey(candyMachineAddress);

  let transaction = new Transaction();
  transaction.add(
    await createWithdrawRewardInstruction(owner, token, candyMachine)
  );
  return transaction;
}
export async function createWithdrawRewardInstruction(
  owner: PublicKey,
  token: PublicKey,
  candyMachine: PublicKey
): Promise<TransactionInstruction> {
  let vaultAddress = await getVaultAddress();
  let metadataAddress = await Metadata.getPDA(token);

  let sourceTokenAccount = await getAssociatedTokenAddress(
    vaultAddress,
    token,
    true
  );
  let destinationTokenAccount = await getAssociatedTokenAddress(owner, token);

  let sourceRewardAccount = await getAssociatedTokenAddress(
    vaultAddress,
    REWARD_MINT,
    true
  );
  let destinationRewardAccount = await getAssociatedTokenAddress(
    owner,
    REWARD_MINT
  );

  let stakeDataAddress = await getStakeDataAddress(token);
  let whitelistDataAddress = await getWhitelistDataAddress(candyMachine);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data: createInstructionData("StakeWithdraw"),
    keys: [
      transactionKey(owner, true),
      transactionKey(SystemProgram.programId, false, false),
      transactionKey(token, false, false),

      transactionKey(TOKEN_PROGRAM_ID, false, false),
      transactionKey(SYSVAR_RENT_PUBKEY, false, false),
      transactionKey(ASSOCIATED_TOKEN_PROGRAM_ID, false, false),

      transactionKey(stakeDataAddress, false),
      transactionKey(vaultAddress, false, false),

      transactionKey(destinationRewardAccount, false),
      transactionKey(sourceRewardAccount, false),
      transactionKey(destinationTokenAccount, false),
      transactionKey(sourceTokenAccount, false),

      transactionKey(metadataAddress, false, false),
      transactionKey(whitelistDataAddress, false),

      transactionKey(REWARD_MINT, false, false),
    ],
  });
}

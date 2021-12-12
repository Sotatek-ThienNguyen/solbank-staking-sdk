import {Transaction} from "@solana/web3.js";

export interface IExtractPoolData {
  nonce: number;
  token_x_stake_account: string;
  token_y_reward_account: string;
  admin: string;
  root_admin: string;
  fee_amount: number;
  fee: number;
}

export interface IResponseTxFee {
  rawTx: Buffer;
  unsignedTransaction: Transaction;
  txFee: number;
}

import {WRAPPED_SOL_MINT} from '@project-serum/serum/lib/token-instructions';
import {AccountLayout, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import Decimal from 'decimal.js';
import {IExtractPoolData, Instructions, StakingPoolLayout, POOL_PROGRAM_ID} from '../index';

export class Actions {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async createPool(payer: PublicKey, tokenX: PublicKey, tokenY: PublicKey, admin: PublicKey) {
    const recentBlockhash = await this.connection.getRecentBlockhash();
    const transaction = new Transaction({
      recentBlockhash: recentBlockhash.blockhash,
      feePayer: payer,
    });

    const {poolAccount, instruction} = await Instructions.createPoolAccountInstruction(this.connection,payer);
    transaction.add(instruction);
    const programId = new PublicKey(POOL_PROGRAM_ID);
    const [poolAuthority, nonce] = await PublicKey.findProgramAddress(
      [poolAccount.publicKey.toBuffer()],
      programId,
    );

    const poolTokenXAccount = Keypair.generate();
    const poolTokenYAccount = Keypair.generate();

    transaction.add(
      await Instructions.createTokenAccountInstruction(
        this.connection,
        payer,
        poolTokenXAccount.publicKey,
      ),
      await Instructions.createTokenAccountInstruction(
        this.connection,
        payer,
        poolTokenYAccount.publicKey,
      ),
      Instructions.createInitTokenAccountInstruction(
        tokenX,
        poolTokenXAccount.publicKey,
        poolAuthority,
      ),
      Instructions.createInitTokenAccountInstruction(
        tokenY,
        poolTokenYAccount.publicKey,
        poolAuthority,
      ),

      Instructions.createInitPoolInstruction(
        {
          poolAccount: poolAccount.publicKey,
          authority: poolAuthority,
          tokenAccountX: poolTokenXAccount.publicKey,
          tokenAccountY: poolTokenYAccount.publicKey,
          admin: admin
        },
        {
          nonce,
        },
      ),
    );

    const unsignedTransaction = Transaction.from(
      transaction.serialize({
        verifySignatures: true,
        requireAllSignatures: false,
      }),
    );
    const unsignedData = transaction.compileMessage().serialize();
    transaction.sign(poolAccount, poolTokenXAccount,poolTokenYAccount);

    return {
      unsignedTransaction,
      unsignedData,
      transaction,
      poolAccount,
      poolTokenXAccount,
      poolTokenYAccount,
    };
  }

  public async getLamportPerSignature(blockhash: any): Promise<number> {
    const feeCalculator = await this.connection.getFeeCalculatorForBlockhash(blockhash);

    const lamportsPerSignature =
      feeCalculator && feeCalculator.value ? feeCalculator.value.lamportsPerSignature : 0;

    return lamportsPerSignature;
  }

  public async createAssociatedTokenAccount(payer: PublicKey, userAddress: PublicKey) {
    const {blockhash} = await this.connection.getRecentBlockhash();
    const transaction = new Transaction({
      recentBlockhash: blockhash,
      feePayer: payer,
    });
    const wrappedUserAddress = await this.findAssociatedTokenAddress(userAddress, WRAPPED_SOL_MINT);
    transaction.add(
      Instructions.createAssociatedTokenAccountInstruction(
        payer,
        userAddress,
        WRAPPED_SOL_MINT,
        wrappedUserAddress,
      )
    )

    const rawTx = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: true,
    });

    return {
      rawTx,
      unsignedTransaction: transaction,
    };
  }


  public async transferPoolAdmin(
    adminAddress: PublicKey,
    newAdminAddress: PublicKey,
    poolAddress: PublicKey,
  ) {
    const {blockhash} = await this.connection.getRecentBlockhash();
    const transaction = new Transaction({
      recentBlockhash: blockhash,
      feePayer: adminAddress,
    });
    const poolProgramId = await this.getPoolProgramId(poolAddress);
    const authority = await this.findPoolAuthority(poolAddress);

    const txFee = await this.getLamportPerSignature(blockhash);

    transaction.add(
      Instructions.transferPoolAdmin(
        {
          poolAccount: poolAddress,
          userAuthority: authority,
          adminAddress: adminAddress,
          newAdminAddress: newAdminAddress,
        },
        poolProgramId,
      ),
    );

    const rawTx = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: true,
    });

    return {
      rawTx,
      txFee,
      unsignedTransaction: transaction,
    };
  }

  public async transferRootAdmin(
    rootAdminAddress: PublicKey,
    newRootAdminAddress: PublicKey,
    poolAddress: PublicKey,
  ) {
    const {blockhash} = await this.connection.getRecentBlockhash();
    const transaction = new Transaction({
      recentBlockhash: blockhash,
      feePayer: rootAdminAddress,
    });
    const poolProgramId = await this.getPoolProgramId(poolAddress);
    const authority = await this.findPoolAuthority(poolAddress);

    const txFee = await this.getLamportPerSignature(blockhash);

    transaction.add(
      Instructions.transferRootAdmin(
        {
          poolAccount: poolAddress,
          userAuthority: authority,
          rootAdminAddress: rootAdminAddress,
          newRootAdminAddress: newRootAdminAddress,
        },
        poolProgramId,
      ),
    );

    const rawTx = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: true,
    });

    return {
      rawTx,
      txFee,
      unsignedTransaction: transaction,
    };
  }

  public async getPoolProgramId(poolAddress: PublicKey): Promise<PublicKey> {
    return this.getOwner(poolAddress);
  }

  public async getOwner(address: PublicKey): Promise<PublicKey> {
    const pool_acc = await this.connection.getAccountInfo(new PublicKey(address));
    if (!pool_acc?.data) {
      throw new Error(`Invalid address`);
    }

    return new PublicKey(pool_acc.owner);
  }

  async findPoolAuthority(poolAddress: PublicKey): Promise<PublicKey> {
    const programId = await this.getPoolProgramId(poolAddress);
    const [authority] = await PublicKey.findProgramAddress([poolAddress.toBuffer()], programId);
    return authority;
  }

  /**
   * Get associated address of target address and can mint token
   *
   * @param targetAddress PublicKey (target address need to find associated)
   * @param tokenMintAddress PublicKey (token can be mint by associated address)
   * @returns Promise<PublicKey>
   */
  async findAssociatedTokenAddress(
    targetAddress: PublicKey,
    tokenMintAddress: PublicKey,
  ): Promise<PublicKey> {
    return (
      await PublicKey.findProgramAddress(
        [targetAddress.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), tokenMintAddress.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID,
      )
    )[0];
  }

  async estimateNetworkTransactionFee(): Promise<number> {
    const {blockhash} = await this.connection.getRecentBlockhash();
    const txFee = await this.getLamportPerSignature(blockhash);

    return txFee;
  }

  public async closeAssociatedTokenAccount(
    payer: PublicKey,
    userAddress: PublicKey,
    tokenMint: PublicKey = WRAPPED_SOL_MINT,
  ) {
    const wrappedUserAddress = await this.findAssociatedTokenAddress(userAddress, tokenMint);
    const wrappedUserAddressAccInfo = await this.connection.getAccountInfo(wrappedUserAddress);
    if (wrappedUserAddressAccInfo?.data) {
      const {blockhash} = await this.connection.getRecentBlockhash();
      const transaction = new Transaction({
        recentBlockhash: blockhash,
        feePayer: payer,
      });
      transaction.add(
        Instructions.closeAccountInstruction({
          programId: TOKEN_PROGRAM_ID,
          account: wrappedUserAddress,
          dest: userAddress,
          owner: userAddress,
          signers: [],
        }),
      );

      const rawTx = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: true,
      });

      return {
        rawTx,
        unsignedTransaction: transaction,
        needClose: true,
      };
    }
    return {
      needClose: false,
    };
  }
}

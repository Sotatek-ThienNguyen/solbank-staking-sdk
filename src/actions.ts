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
import {IExtractPoolData, Instructions, PoolLayout, POOL_PROGRAM_ID} from '../index';

export class Actions {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
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

  public async withdraw(
    adminAddress: PublicKey,
    withdrawAddress: PublicKey,
    poolAddress: PublicKey,
    amount: number,
  ) {
    const {blockhash} = await this.connection.getRecentBlockhash();
    const transaction = new Transaction({
      recentBlockhash: blockhash,
      feePayer: adminAddress,
    });
    const poolProgramId = await this.getPoolProgramId(poolAddress);
    const {token_x} = await this.readPool(poolAddress);
    const authority = await this.findPoolAuthority(poolAddress);
    const {
      associatedAddress: associatedAdminToken,
      exists: associatedAddressExists,
    } = await this.getAssociatedAccountInfo(adminAddress, WRAPPED_SOL_MINT);

    if (!associatedAddressExists) {
      // create associated address if not exists
      transaction.add(
        Instructions.createAssociatedTokenAccountInstruction(
          adminAddress,
          adminAddress,
          WRAPPED_SOL_MINT,
          associatedAdminToken,
        ),
      );
    }

    const txFee = await this.getLamportPerSignature(blockhash);

    transaction.add(
      Instructions.withdraw(
        {
          poolAccount: poolAddress,
          userAuthority: authority,
          adminAccount: adminAddress,
          withdrawAccount: associatedAdminToken,
          poolSourceTokenAccount: new PublicKey(token_x),
          tokenProgramId: TOKEN_PROGRAM_ID,
        },
        {
          outcoming_amount: amount * LAMPORTS_PER_SOL
        },
        poolProgramId,
      ),
      Instructions.closeAccountInstruction({
        programId: TOKEN_PROGRAM_ID,
        account: associatedAdminToken,
        dest: adminAddress,
        owner: adminAddress,
        signers: [],
      }),
      SystemProgram.transfer({
        fromPubkey: adminAddress,
        toPubkey: withdrawAddress,
        lamports: amount * LAMPORTS_PER_SOL,
      }),
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

  async readPool(poolAddress: PublicKey): Promise<IExtractPoolData> {
    const accountInfo = await this.connection.getAccountInfo(poolAddress);
    if (!accountInfo) {
      throw new Error('Can not find pool address');
    }
    const result = PoolLayout.decode(Buffer.from(accountInfo.data));

    const poolData = {
      nonce: result.nonce,
      root_admin: new PublicKey(result.root_admin).toString(),
      admin: new PublicKey(result.admin).toString(),
      token_x: new PublicKey(result.token_x).toString(),
      fee_amount: new Decimal(result.fee_amount).toNumber(),
      fee: new Decimal(result.fee).toNumber(),
    };

    console.log(poolData, '--poolData');
    return poolData;
  }

  async createPool(payer: PublicKey, tokenX: PublicKey, fee: number) {
    const recentBlockhash = await this.connection.getRecentBlockhash();
    const transaction = new Transaction({
      recentBlockhash: recentBlockhash.blockhash,
      feePayer: payer,
    });

    const {poolAccount, instruction} = await Instructions.createPoolAccountInstruction(
      this.connection,
      payer,
    );
    transaction.add(instruction);
    const programId = new PublicKey(POOL_PROGRAM_ID);
    const [poolAuthority, nonce] = await PublicKey.findProgramAddress(
      [poolAccount.publicKey.toBuffer()],
      programId,
    );
    const poolTokenXAccount = Keypair.generate();

    transaction.add(
      await Instructions.createTokenAccountInstruction(
        this.connection,
        payer,
        poolTokenXAccount.publicKey,
      ),
      Instructions.createInitTokenAccountInstruction(
        tokenX,
        poolTokenXAccount.publicKey,
        poolAuthority,
      ),

      Instructions.createInitPoolInstruction(
        {
          poolAccount: poolAccount.publicKey,
          authority: poolAuthority,
          rootAdminAccount: payer,
          tokenAccountX: poolTokenXAccount.publicKey,
          payerAccount: payer,
        },
        {
          fee,
          nonce,
        },
      ),
    );

    const unsignedTransaction = Transaction.from(
      transaction.serialize({
        verifySignatures: false,
        requireAllSignatures: false,
      }),
    );
    const unsignedData = transaction.compileMessage().serialize();
    transaction.sign(poolAccount, poolTokenXAccount);

    return {
      unsignedTransaction,
      unsignedData,
      transaction,
      poolAccount,
      poolTokenXAccount,
    };
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
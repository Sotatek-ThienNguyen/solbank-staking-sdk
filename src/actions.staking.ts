import {Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction} from "@solana/web3.js";
import {StakeInstructions} from "./utils/stakeInstructions";
import {CURRENT_STAKE_PROGRAM_ID} from "./constants";
import {IExtractPoolData, Instructions, IResponseTxFee, StakingPoolLayout} from "./utils";
import Decimal from "decimal.js";
import {AccountLayout, ASSOCIATED_TOKEN_PROGRAM_ID, MintLayout, Token, TOKEN_PROGRAM_ID} from "@solana/spl-token";

export class ActionsStaking {
    private connection: Connection;

    constructor(connection: Connection) {
        this.connection = connection;
    }

    public async getOwner(address: PublicKey): Promise<PublicKey> {
        const pool_acc = await this.connection.getAccountInfo(new PublicKey(address));
        if (!pool_acc?.data) {
            throw new Error(`Invalid address`);
        }

        return new PublicKey(pool_acc.owner);
    }
    public async getStakePoolProgramId(stakePoolAddress: PublicKey): Promise<PublicKey> {
        return this.getOwner(stakePoolAddress);
    }

    /**
     * Find the authority with specific address on-chain
     *
     * @returns Promise<PublicKey>
     * @param stakePoolAddress
     */
    async findPoolAuthority(stakePoolAddress: PublicKey): Promise<PublicKey> {
        const programId = await this.getStakePoolProgramId(stakePoolAddress);
        const [authority] = await PublicKey.findProgramAddress([stakePoolAddress.toBuffer()], programId);
        return authority;
    }

    async readPool(poolAddress: PublicKey): Promise<IExtractPoolData> {
        const accountInfo = await this.connection.getAccountInfo(poolAddress);
        if (!accountInfo) {
            throw new Error('Can not find pool address');
        }
        const result = StakingPoolLayout.decode(Buffer.from(accountInfo.data));

        const poolData = {
            nonce: result.nonce,
            root_admin: new PublicKey(result.root_admin).toString(),
            admin: new PublicKey(result.admin).toString(),
            token_x_stake_account: new PublicKey(result.token_x_stake_account).toString(),
            token_y_reward_account: new PublicKey(result.token_y_reward_account).toString(),
            fee_amount: new Decimal(result.fee_amount).toNumber(),
            fee: new Decimal(result.fee).toNumber(),
        };

        return poolData;
    }


    // base function
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

    // base function
    public async getSPLMintTokenAccountInfo(tokenAccountAddress: PublicKey): Promise<PublicKey> {
        const token_acc = await this.connection.getAccountInfo(new PublicKey(tokenAccountAddress));
        if (!token_acc?.data) {
            throw new Error(`Invalid tokenAccountAddress`);
        }

        const tokenInfo = AccountLayout.decode(token_acc.data);
        return new PublicKey(tokenInfo.mint);
    }

    // base function
    public async getTokenDecimalsFromTokenAccount(tokenAccountAddress: PublicKey): Promise<number> {
        const mintAccount = await this.getSPLMintTokenAccountInfo(new PublicKey(tokenAccountAddress));
        const token_acc = await this.connection.getAccountInfo(new PublicKey(mintAccount));
        if (!token_acc?.data) {
            throw new Error(`Invalid token`);
        }
        const tokenInfo = MintLayout.decode(token_acc.data);
        return tokenInfo.decimals;
    }

    // base function
    public async getTokenDecimalsFromMintAccount(tokenAccountAddress: PublicKey): Promise<number> {
        const token_acc = await this.connection.getAccountInfo(new PublicKey(tokenAccountAddress));
        if (!token_acc?.data) {
            throw new Error(`Invalid token`);
        }
        const tokenInfo = MintLayout.decode(token_acc.data);
        return tokenInfo.decimals;
    }


    /**
     * Send reward from admin token Y account and create stake pool snapshot
     * @param payer
     * @param adminAddress
     * @param stakePoolAddress
     * @param amount
     */
    public async sendRewardToStakePoolByAdmin(
        payer: PublicKey,
        adminAddress: PublicKey,
        stakePoolAddress: PublicKey,
        amount: number, // this amount is a value after separated with token decimal big number
    ): Promise<IResponseTxFee> {
        const {blockhash} = await this.connection.getRecentBlockhash();
        const transaction = new Transaction({
            recentBlockhash: blockhash,
            feePayer: payer,
        });
        const stakePoolProgramId = await this.getStakePoolProgramId(stakePoolAddress);
        const {token_y_reward_account, token_x_stake_account} = await this.readPool(stakePoolAddress);
        const authority = await this.findPoolAuthority(stakePoolAddress);
        const mintTokenYAddress = await this.getSPLMintTokenAccountInfo(new PublicKey(token_y_reward_account))
        const adminTokenYAddress = await this.findAssociatedTokenAddress(adminAddress, new PublicKey(mintTokenYAddress));
        const tokenYDecimal = await this.getTokenDecimalsFromMintAccount(mintTokenYAddress);

        const txFee = await this.getLamportPerSignature(blockhash);

        transaction.add(
            // approve to pool to withdraw admin token Y
            Instructions.createApproveInstruction({
                programId: TOKEN_PROGRAM_ID,
                source: adminTokenYAddress,
                delegate: authority,
                owner: adminAddress,
                amount: amount * Math.pow(10, tokenYDecimal),
                signers: [adminAddress],
            }),
            StakeInstructions.sendRewardToPoolByAdmin(
                {
                    adminAccount: adminAddress,
                    adminAssociatedTokenYAccount: adminTokenYAddress,
                    poolTokenXStakeAccount: new PublicKey(token_x_stake_account),
                    poolTokenYRewardAccount: new PublicKey(token_y_reward_account),
                    stakePoolAccount: new PublicKey(stakePoolAddress),
                    stakePoolAuthority: new PublicKey(authority),
                    tokenProgramId: TOKEN_PROGRAM_ID
                },
                {
                    incoming_amount: amount * Math.pow(10, tokenYDecimal),
                },
                stakePoolProgramId,
            ),
        );

        const rawTx = transaction.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
        });

        return {
            rawTx,
            txFee,
            unsignedTransaction: transaction,
        };
    }


    /**
     * Stake by user
     * @param payer
     * @param userAddress
     * @param stakePoolAddress PublicKey
     * @param amount number
     * @returns Promise<string> transaction id
     */
    public async stakeByUser(
        payer: PublicKey,
        userAddress: PublicKey,
        stakePoolAddress: PublicKey,
        amount: number,
    ): Promise<IResponseTxFee> {
        const {blockhash} = await this.connection.getRecentBlockhash();
        const transaction = new Transaction({
            recentBlockhash: blockhash,
            feePayer: payer,
        });
        const stakePoolProgramId = await this.getStakePoolProgramId(stakePoolAddress);
        const {token_x_stake_account, token_y_reward_account} = await this.readPool(stakePoolAddress);
        const authority = await this.findPoolAuthority(stakePoolAddress);
        const mintTokenXAddress = await this.getSPLMintTokenAccountInfo(new PublicKey(token_x_stake_account))
        const mintTokenYAddress = await this.getSPLMintTokenAccountInfo(new PublicKey(token_y_reward_account))
        const userTokenXAddress = await this.findAssociatedTokenAddress(userAddress, new PublicKey(mintTokenXAddress));
        const userTokenYAddress = await this.findAssociatedTokenAddress(userAddress, new PublicKey(mintTokenYAddress));
        const tokenXDecimal = await this.getTokenDecimalsFromMintAccount(mintTokenXAddress);

        const {
            exists: isExisted,
            associatedAddress: stakePoolMemberAccount,
        } = await this.getStakePoolAssociatedAccountInfo(userAddress, stakePoolAddress);

        if (!isExisted) {
            // create joined user data if not exists
            transaction.add(
                StakeInstructions.initStakeMemberAccount(
                    userAddress,
                    new PublicKey(CURRENT_STAKE_PROGRAM_ID),
                    stakePoolAddress,
                ),
                StakeInstructions.initStakeMemberData(
                    userAddress,
                    stakePoolAddress,
                    new PublicKey(stakePoolMemberAccount),
                ),
            );
        }

        const txFee = await this.getLamportPerSignature(blockhash);
        transaction.add(
            Instructions.createApproveInstruction({
                programId: TOKEN_PROGRAM_ID,
                source: userTokenXAddress,
                delegate: authority,
                owner: userAddress,
                amount: amount * Math.pow(10, tokenXDecimal),
                signers: [userAddress],
            }),
            StakeInstructions.stakeByUser(
                {
                    poolTokenXStakeAccount: new PublicKey(token_x_stake_account),
                    poolTokenYRewardAccount:  new PublicKey(token_y_reward_account),
                    stakePoolAccount: new PublicKey(stakePoolAddress),
                    stakePoolAuthority: authority,
                    tokenProgramId: TOKEN_PROGRAM_ID,
                    userAccount: new PublicKey(userAddress),
                    userAssociatedTokenXAccount: new PublicKey(userTokenXAddress),
                    userAssociatedTokenYAccount: new PublicKey(userTokenYAddress),
                    userStakeAccount: new PublicKey(stakePoolMemberAccount)
                },
                {
                    incoming_amount: amount * Math.pow(10, tokenXDecimal),
                },
                stakePoolProgramId,
            ),
        );

        const rawTx = transaction.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
        });

        return {
            rawTx,
            txFee,
            unsignedTransaction: transaction,
        };
    }

    /**
     * Withdraw reward by user
     * @param payer
     * @param userAddress
     * @param stakePoolAddress PublicKey
     * @returns Promise<string> transaction id
     */
    public async withdrawRewardByUser(
        payer: PublicKey,
        userAddress: PublicKey,
        stakePoolAddress: PublicKey,
    ): Promise<IResponseTxFee> {
        const {blockhash} = await this.connection.getRecentBlockhash();
        const transaction = new Transaction({
            recentBlockhash: blockhash,
            feePayer: payer,
        });
        const stakePoolProgramId = await this.getStakePoolProgramId(stakePoolAddress);
        const {token_y_reward_account} = await this.readPool(stakePoolAddress);
        const authority = await this.findPoolAuthority(stakePoolAddress);
        const mintTokenYAddress = await this.getSPLMintTokenAccountInfo(new PublicKey(token_y_reward_account));
        const userTokenYAddress = await this.findAssociatedTokenAddress(userAddress, new PublicKey(mintTokenYAddress));

        const {
            exists: isExisted,
            associatedAddress: stakePoolMemberAccount,
        } = await this.getStakePoolAssociatedAccountInfo(userAddress, stakePoolAddress);

        if (!isExisted) {
            // create joined user data if not exists
            transaction.add(
                StakeInstructions.initStakeMemberAccount(
                    userAddress,
                    new PublicKey(CURRENT_STAKE_PROGRAM_ID),
                    stakePoolAddress,
                ),
                StakeInstructions.initStakeMemberData(
                    userAddress,
                    stakePoolAddress,
                    new PublicKey(stakePoolMemberAccount),
                ),
            );
        }

        const txFee = await this.getLamportPerSignature(blockhash);
        transaction.add(
            StakeInstructions.withdrawRewardsByUser(
                {
                    poolTokenYRewardAccount:  new PublicKey(token_y_reward_account),
                    stakePoolAccount: new PublicKey(stakePoolAddress),
                    stakePoolAuthority: authority,
                    tokenProgramId: TOKEN_PROGRAM_ID,
                    userAccount: new PublicKey(userAddress),
                    userAssociatedTokenYAccount: new PublicKey(userTokenYAddress),
                    userStakeAccount: new PublicKey(stakePoolMemberAccount)
                },
                stakePoolProgramId,
            ),
        );

        const rawTx = transaction.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
        });

        return {
            rawTx,
            txFee,
            unsignedTransaction: transaction,
        };
    }


    /**
     * Check associated address exists or not
     *
     * @param targetAddress PublicKey
     * @param stakePoolAddress PublicKey
     * @returns Promise<{associatedAddress: PublicKey, exists: boolean}>
     */
    public async getStakePoolAssociatedAccountInfo(
        targetAddress: PublicKey,
        stakePoolAddress: PublicKey,
    ): Promise<{associatedAddress: PublicKey; exists: boolean}> {
        const associatedAccount = await this.findAssociatedStakeAddress(targetAddress, stakePoolAddress);

        try {
            const accountInfo = await this.connection.getAccountInfo(associatedAccount);

            return {
                associatedAddress: associatedAccount,
                exists: accountInfo ? true : false,
            };
        } catch (err) {
            return {
                associatedAddress: associatedAccount,
                exists: false,
            };
        }
    }

    async findAssociatedStakeAddress(
        targetAddress: PublicKey,
        stakePoolAddress,
    ): Promise<PublicKey> {
        return (
            await PublicKey.findProgramAddress(
                [
                    targetAddress.toBuffer(),
                    new PublicKey(CURRENT_STAKE_PROGRAM_ID).toBuffer(),
                    stakePoolAddress.toBuffer(),
                ],
                new PublicKey(CURRENT_STAKE_PROGRAM_ID),
            )
        )[0];
    }

    /**
     * Init stake member corresponded with a stake pool
     * @param payer
     * @param userAddress
     * @param stakePoolAddress
     */
    async initStakeMember(payer: PublicKey, userAddress: PublicKey, stakePoolAddress: PublicKey) {
        const recentBlockhash = await this.connection.getRecentBlockhash();
        const transaction = new Transaction({
            recentBlockhash: recentBlockhash.blockhash,
            feePayer: payer,
        });

        const memberStakeAccount = await this.findAssociatedStakeAddress(userAddress, stakePoolAddress);
        transaction.add(
            StakeInstructions.initStakeMemberAccount(
                userAddress,
                new PublicKey(CURRENT_STAKE_PROGRAM_ID),
                stakePoolAddress,
            ),
            StakeInstructions.initStakeMemberData(
                userAddress,
                stakePoolAddress,
                memberStakeAccount,
            ),
        );

        return {transaction};
    }

    // base function
    public async getLamportPerSignature(blockhash): Promise<number> {
        const feeCalculator = await this.connection.getFeeCalculatorForBlockhash(blockhash);

        const lamportsPerSignature =
            feeCalculator && feeCalculator.value ? feeCalculator.value.lamportsPerSignature : 0;

        return lamportsPerSignature;
    }
}
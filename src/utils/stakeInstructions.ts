import {PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction} from "@solana/web3.js";
import * as BufferLayout from 'buffer-layout';
import {clockSysvarAccount, CURRENT_STAKE_PROGRAM_ID} from "../constants";
import * as Layout from './layout';
import {Numberu64} from "./layout";

export class StakeInstructions {

    static initStakeMemberAccount(
        owner: PublicKey,
        associatedStakeAccount: PublicKey,
        stake: PublicKey,
    ): TransactionInstruction {
        const keys = [
            {
                pubkey: SystemProgram.programId,
                isSigner: false,
                isWritable: false,
            },
            {pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false},
            {pubkey: owner, isSigner: true, isWritable: true},
            {pubkey: associatedStakeAccount, isSigner: false, isWritable: true},
            {pubkey: stake, isSigner: false, isWritable: false},
        ];

        const commandDataLayout = BufferLayout.struct([BufferLayout.u8('instruction')]);

        let data = Buffer.alloc(1024);
        {
            const encodeLength = commandDataLayout.encode(
                {
                    instruction: 1, // Early Join Pool instruction
                },
                data,
            );
            data = data.slice(0, encodeLength);
        }

        return new TransactionInstruction({
            keys,
            programId: new PublicKey(CURRENT_STAKE_PROGRAM_ID),
            data,
        });
    }


    static initStakeMemberData(
        owner: PublicKey,
        stakePoolAddress: PublicKey,
        associatedStakeAccount: PublicKey,
    ): TransactionInstruction {
        const keys = [
            {pubkey: associatedStakeAccount, isSigner: false, isWritable: true},
            {pubkey: stakePoolAddress, isSigner: false, isWritable: false},
            {pubkey: owner, isSigner: false, isWritable: false},
            {pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false},
        ];

        const commandDataLayout = BufferLayout.struct([BufferLayout.u8('instruction')]);

        let data = Buffer.alloc(1024);
        {
            const encodeLength = commandDataLayout.encode(
                {
                    instruction: 5, // init member data
                },
                data,
            );
            data = data.slice(0, encodeLength);
        }
        return new TransactionInstruction({
            keys,
            programId: new PublicKey(CURRENT_STAKE_PROGRAM_ID),
            data,
        });
    }

    static sendRewardToPoolByAdmin(
        accounts: {
            stakePoolAccount: PublicKey;
            stakePoolAuthority: PublicKey;
            tokenProgramId: PublicKey;

            adminAccount: PublicKey;
            adminAssociatedTokenYAccount: PublicKey;

            poolTokenXStakeAccount: PublicKey;
            poolTokenYRewardAccount: PublicKey;
        },
        inputData: {
            incoming_amount: number;
        },
        poolProgramId: PublicKey,
    ): TransactionInstruction {
        const {
            stakePoolAccount,
            stakePoolAuthority,

            adminAccount,
            adminAssociatedTokenYAccount,

            poolTokenXStakeAccount,
            poolTokenYRewardAccount,
            tokenProgramId,
        } = accounts;
        const keys = [
            {pubkey: stakePoolAccount, isSigner: false, isWritable: true},
            {pubkey: stakePoolAuthority, isSigner: false, isWritable: false},
            {pubkey: tokenProgramId, isSigner: false, isWritable: false},
            {pubkey: adminAccount, isSigner: true, isWritable: true},
            {pubkey: adminAssociatedTokenYAccount, isSigner: false, isWritable: true},
            {pubkey: poolTokenXStakeAccount, isSigner: false, isWritable: true},
            {pubkey: poolTokenYRewardAccount, isSigner: false, isWritable: true},
            {
                pubkey: clockSysvarAccount,
                isSigner: false,
                isWritable: false,
            },
        ];

        const commandDataLayout = BufferLayout.struct([
            BufferLayout.u8('instruction'),
            Layout.uint64('incoming_amount'),
        ]);

        let data = Buffer.alloc(1024);
        {
            const encodeLength = commandDataLayout.encode(
                {
                    instruction: 101, // Join instruction
                    incoming_amount: new Numberu64(inputData.incoming_amount).toBuffer(),
                },
                data,
            );
            data = data.slice(0, encodeLength);
        }

        return new TransactionInstruction({
            keys,
            programId: poolProgramId,
            data,
        });
    }


    static stakeByUser(
        accounts: {
            stakePoolAccount: PublicKey;
            stakePoolAuthority: PublicKey;
            tokenProgramId: PublicKey;

            userAccount: PublicKey;
            userStakeAccount: PublicKey;

            userAssociatedTokenXAccount: PublicKey;
            poolTokenXStakeAccount: PublicKey;

            userAssociatedTokenYAccount: PublicKey;
            poolTokenYRewardAccount: PublicKey;
        },
        inputData: {
            incoming_amount: number;
        },
        poolProgramId: PublicKey,
    ): TransactionInstruction {
        const {
            stakePoolAccount,
            stakePoolAuthority,
            userAccount,
            userStakeAccount,
            userAssociatedTokenXAccount,
            userAssociatedTokenYAccount,
            poolTokenXStakeAccount,
            poolTokenYRewardAccount,
            tokenProgramId,
        } = accounts;
        const keys = [
            {pubkey: stakePoolAccount, isSigner: false, isWritable: true},
            {pubkey: stakePoolAuthority, isSigner: false, isWritable: false},
            {pubkey: tokenProgramId, isSigner: false, isWritable: false},
            {pubkey: userAccount, isSigner: true, isWritable: true},
            {pubkey: userStakeAccount, isSigner: true, isWritable: true},
            {pubkey: userAssociatedTokenXAccount, isSigner: false, isWritable: true},
            {pubkey: poolTokenXStakeAccount, isSigner: false, isWritable: true},
            {pubkey: userAssociatedTokenYAccount, isSigner: false, isWritable: true},
            {pubkey: poolTokenYRewardAccount, isSigner: false, isWritable: true},
            {
                pubkey: clockSysvarAccount,
                isSigner: false,
                isWritable: false,
            },
        ];

        const commandDataLayout = BufferLayout.struct([
            BufferLayout.u8('instruction'),
            Layout.uint64('incoming_amount'),
        ]);

        let data = Buffer.alloc(1024);
        {
            const encodeLength = commandDataLayout.encode(
                {
                    instruction: 2, // stake instruction
                    incoming_amount: new Numberu64(inputData.incoming_amount).toBuffer(),
                },
                data,
            );
            data = data.slice(0, encodeLength);
        }

        return new TransactionInstruction({
            keys,
            programId: poolProgramId,
            data,
        });
    }

    static withdrawRewardsByUser(
        accounts: {
            stakePoolAccount: PublicKey;
            stakePoolAuthority: PublicKey;

            userAccount: PublicKey;
            userStakeAccount: PublicKey;

            userAssociatedTokenYAccount: PublicKey;
            poolTokenYRewardAccount: PublicKey;
            tokenProgramId: PublicKey;
        },
        poolProgramId: PublicKey,
    ): TransactionInstruction {
        const {
            stakePoolAccount,
            stakePoolAuthority,
            userAccount,
            userStakeAccount,
            userAssociatedTokenYAccount,
            poolTokenYRewardAccount,
            tokenProgramId,
        } = accounts;
        const keys = [
            {pubkey: stakePoolAccount, isSigner: false, isWritable: true},
            {pubkey: stakePoolAuthority, isSigner: false, isWritable: false},
            {pubkey: userAccount, isSigner: true, isWritable: true},
            {pubkey: userStakeAccount, isSigner: true, isWritable: true},
            {pubkey: userAssociatedTokenYAccount, isSigner: false, isWritable: true},
            {pubkey: poolTokenYRewardAccount, isSigner: false, isWritable: true},
            {pubkey: tokenProgramId, isSigner: false, isWritable: false},
            {
                pubkey: clockSysvarAccount,
                isSigner: false,
                isWritable: false,
            },
        ];

        const commandDataLayout = BufferLayout.struct([
            BufferLayout.u8('instruction'),
        ]);

        let data = Buffer.alloc(1024);
        {
            const encodeLength = commandDataLayout.encode(
                {
                    instruction: 3, // withdraw reward instruction
                },
                data,
            );
            data = data.slice(0, encodeLength);
        }

        return new TransactionInstruction({
            keys,
            programId: poolProgramId,
            data,
        });
    }
}
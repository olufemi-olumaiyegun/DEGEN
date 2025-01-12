import { CommandContext, EmbedField } from 'slash-create';
import {
	DMChannel,
	GuildMember,
	MessageEmbedOptions,
	Message as Message,
} from 'discord.js';
import {
	Collection,
	Cursor,
	Db,
	UpdateWriteOpResult,
} from 'mongodb';
import MongoDbUtils from '../../utils/MongoDbUtils';
import constants from '../constants/constants';
import { POAPUnclaimedParticipants } from '../../types/poap/POAPUnclaimedParticipants';
import Log, { LogUtils } from '../../utils/Log';
import { POAPTwitterUnclaimedParticipants } from '../../types/poap/POAPTwitterUnclaimedParticipants';
import {
	retrieveVerifiedTwitter,
	VerifiedTwitter,
} from '../account/VerifyTwitter';
import dayjs from 'dayjs';
import {
	EmbedField as EmbedFieldSlash,
	Message as MessageSlash,
	MessageEmbedOptions as MessageEmbedOptionsSlash,
} from 'slash-create';
import POAPUtils from '../../utils/POAPUtils';
import ValidationError from '../../errors/ValidationError';
import OptInPOAP from './OptInPOAP';
import ServiceUtils from '../../utils/ServiceUtils';

const ClaimPOAP = async (ctx: CommandContext, platform: string, guildMember?: GuildMember): Promise<any> => {
	Log.debug(`starting claim for ${ctx.user.username}, with ID: ${ctx.user.id}`);
	
	await ctx.defer(true);
	
	if (platform == constants.PLATFORM_TYPE_TWITTER) {
		if (!guildMember) {
			await ctx.send({ content: 'Please try command within discord server.', ephemeral: true });
			return;
		}
		await claimPOAPForTwitter(ctx, guildMember);
		return;
	}
	let isDmOn = false;
	
	if (guildMember) {
		isDmOn = await ServiceUtils.tryDMUser(guildMember, 'gm');
		if (isDmOn) {
			try {
				await ctx.send({ content: 'DM sent!', ephemeral: true });
				const dmChannel: DMChannel = await guildMember.createDM();
				await claimForDiscord(ctx.user.id, null, dmChannel);
				await OptInPOAP(guildMember.user, dmChannel).catch(e => {
					Log.error(e);
					ServiceUtils.sendOutErrorMessageForDM(dmChannel).catch(Log.error);
				});
				return;
			} catch (e) {
				LogUtils.logError('failed to ask for opt-in', e);
			}
		}
	}
	await claimForDiscord(ctx.user.id, ctx);
};

export const claimForDiscord = async (userId: string, ctx?: CommandContext | null, dmChannel?: DMChannel | null): Promise<void> => {
	Log.debug('Discord platform chosen');
	
	const db: Db = await MongoDbUtils.connect(constants.DB_NAME_DEGEN);
	const unclaimedParticipantsCollection: Collection<POAPUnclaimedParticipants> = await db.collection(constants.DB_COLLECTION_POAP_UNCLAIMED_PARTICIPANTS);
	
	Log.debug('looking for POAP in db');
	let unclaimedParticipants: Cursor<POAPUnclaimedParticipants> = await unclaimedParticipantsCollection.find({
		discordUserId: userId,
	});
	
	Log.debug('checking for POAP from db');
	if (!await unclaimedParticipants.hasNext()) {
		Log.debug('POAP not found');
		const msg = 'There doesn\'t seem to be any POAPs yet.';
		if (ctx) {
			await ctx.send({ content: msg, ephemeral: true });
		} else if (dmChannel) {
			await dmChannel.send(msg);
		}
		return;
	}
	
	const numberOfPOAPs: number = await unclaimedParticipants.count();
	Log.debug(`${numberOfPOAPs} POAP found`);
	POAPUtils.validateMaximumPOAPClaims(numberOfPOAPs);
	
	// resetting the cursor from the count
	unclaimedParticipants = await unclaimedParticipantsCollection.find({
		discordUserId: userId,
	});
	
	let result: Message | MessageSlash | boolean | void;
	if (ctx) {
		Log.debug('sending message in channel');
		await ctx.send({ content: 'POAP claimed! Consider sending `gm` to DEGEN to get POAPs directly in your wallet.', ephemeral: false });
		const embeds: MessageEmbedOptionsSlash[] = await generatePOAPClaimEmbedMessages(numberOfPOAPs, unclaimedParticipants) as MessageEmbedOptionsSlash[];
		result = await ctx.send({
			embeds: embeds,
			ephemeral: true,
		}).catch(e => {
			LogUtils.logError('failed to provide poap links to user', e);
			throw new ValidationError('try the command in a valid channel');
		});
	} else if (dmChannel) {
		Log.debug('sending DM to user');
		const embeds: MessageEmbedOptions[] = await generatePOAPClaimEmbedMessages(numberOfPOAPs, unclaimedParticipants) as MessageEmbedOptions[];
		result = await dmChannel.send({
			embeds: embeds,
		}).catch(e => {
			LogUtils.logError('failed to send POAP to user wallet', e);
			throw new ValidationError('Try turning on DMs!');
		});
	}
	if (result == null) {
		Log.warn('failed to send poaps');
		return;
	}
	
	Log.debug('message sent to user!');
	
	const expirationDate: string = dayjs().add(1, 'day').toISOString();
	const resultUpdate: UpdateWriteOpResult | void = await unclaimedParticipantsCollection.updateMany({
		discordUserId: userId,
		expiresAt: {
			$gt: expirationDate,
		},
	}, {
		$set: {
			expiresAt: expirationDate,
		},
	}).catch(Log.error);
	
	if (resultUpdate == null) {
		throw new Error('failed to update expiration date for POAPs');
	}
	
	if (resultUpdate.result.nModified > 0) {
		Log.debug('updated expiration dates for POAPs in DB and POAPs claimed');
	} else {
		Log.debug('existing POAPs found that are expiring soon');
	}
};

const claimPOAPForTwitter = async (ctx: CommandContext, guildMember: GuildMember) => {
	Log.debug('claiming POAP for Twitter');

	const verifiedTwitter: VerifiedTwitter | null = await retrieveVerifiedTwitter(guildMember);
	
	if (verifiedTwitter == null) {
		
		return;
	}
	
	const db: Db = await MongoDbUtils.connect(constants.DB_NAME_DEGEN);
	const unclaimedParticipantsCollection: Collection<POAPTwitterUnclaimedParticipants> = await db.collection(constants.DB_COLLECTION_POAP_TWITTER_UNCLAIMED_PARTICIPANTS);

	Log.debug('looking for POAP in twitter db');
	let unclaimedParticipants: Cursor<POAPTwitterUnclaimedParticipants> = await unclaimedParticipantsCollection.find({
		twitterUserId: verifiedTwitter.twitterUser.id_str,
	});

	Log.debug('checking for POAP from twitter db');
	if (!await unclaimedParticipants.hasNext()) {
		Log.debug('POAP not found');
		await ctx.send('Sorry bud, I couldn\'t find anything...');
		return;
	}
	const numberOfPOAPs: number = await unclaimedParticipants.count();
	Log.debug('POAP found');
	POAPUtils.validateMaximumPOAPClaims(numberOfPOAPs);
	
	// resetting the cursor from the count
	unclaimedParticipants = await unclaimedParticipantsCollection.find({
		twitterUserId: verifiedTwitter.twitterUser.id_str,
	});
	
	// TODO: use generatePOAPClaimEmbedMessages to handle 240 POAPs
	const fieldsList: EmbedField[] = await unclaimedParticipants.map((doc: POAPTwitterUnclaimedParticipants) => {
		return ({
			name: 'Claim Link',
			value: `${doc.poapLink}`,
			inline: false,
		} as EmbedField);
	}).toArray();
	
	await ctx.send({
		embeds: [{
			title: 'POAP link',
			description: 'Thank you for participating in the community event!',
			fields: fieldsList,
		}],
		ephemeral: true,
	});
	
	Log.debug('message sent to user! POAP claimed');
	
	unclaimedParticipantsCollection.updateMany({
		twitterUserId:  verifiedTwitter.twitterUser.id_str,
	}, {
		$set: {
			expiresAt: dayjs().add(1, 'day').toISOString(),
		},
	}).catch(Log.error);
	Log.debug('updated expiration for POAPs in DB and POAPs claimed');
};

/**
 * Generate an array of message embed objects where each object has a maximum of 24 fields.
 * @param numberOfPOAPs
 * @param unclaimedParticipants
 */
const generatePOAPClaimEmbedMessages = async (
	numberOfPOAPs: number,
	unclaimedParticipants: Cursor<POAPUnclaimedParticipants>,
): Promise<MessageEmbedOptions[] | MessageEmbedOptionsSlash[]> => {
	Log.debug('starting to process POAPs for embed message');
	const embedOptions: MessageEmbedOptions[] | MessageEmbedOptionsSlash[] = [];
	let embedFields: EmbedField[] | EmbedFieldSlash[] = [];
	let k = 0;
	while (await unclaimedParticipants.hasNext()) {
		const doc: POAPUnclaimedParticipants | null = await unclaimedParticipants.next();
		if (doc == null) {
			continue;
		}
		if (k < 8) {
			embedFields.push({
				name: 'Event',
				value: `${doc.event}`,
				inline: true,
			} as EmbedField);
			embedFields.push({
				name: 'Server',
				value: `${doc.discordServerName}`,
				inline: true,
			} as EmbedField);
			embedFields.push({
				name: 'Claim Link',
				value: `${doc.poapLink}`,
				inline: false,
			} as EmbedField);
			k++;
		} else {
			embedOptions.push({
				title: 'POAP Badge',
				description: 'Thank you for participating in the community event!',
				fields: embedFields,
			});
			k = 0;
			embedFields = [{
				name: 'Event',
				value: `${doc.event}`,
				inline: true,
			}, {
				name: 'Server',
				value: `${doc.discordServerName}`,
				inline: true,
			}, {
				name: 'Claim Link',
				value: `${doc.poapLink}`,
				inline: false,
			}];
		}
	}
	if (embedFields.length >= 1) {
		embedOptions.push({
			title: 'POAP Badge',
			description: 'Thank you for participating in the community event!',
			fields: embedFields,
		});
	}
	Log.debug('finished processing POAPs for embed message');
	return embedOptions;
};

export default ClaimPOAP;

import { CommandContext } from 'slash-create';
import {
	GuildMember,
	MessageEmbedOptions,
} from 'discord.js';
import Log from '../../utils/Log';
import ServiceUtils from '../../utils/ServiceUtils';
import {
	retrieveVerifiedTwitter,
	VerifiedTwitter,
} from './VerifyTwitter';
import {
	MessageEmbedOptions as MessageEmbedOptionsSlash,
} from 'slash-create';

const ListAccounts = async (ctx: CommandContext, guildMember: GuildMember): Promise<void> => {
	Log.debug('starting to list external accounts');
	
	const isDmOn: boolean = await ServiceUtils.tryDMUser(guildMember, 'Attempting to list external accounts.');
	
	// important
	await ctx.defer(true);
	
	if (isDmOn) {
		await ctx.send({ content: 'DM sent!', ephemeral: true });
	}
	
	const twitterUser: VerifiedTwitter | null = await retrieveVerifiedTwitter(guildMember);
	
	if (twitterUser == null) {
		await ServiceUtils.sendContextMessage({ content: 'No external accounts found!' }, isDmOn, guildMember, ctx);
		return;
	}
	
	if (isDmOn) {
		const embedMsg: MessageEmbedOptions = generateTwitterEmbedItem(twitterUser) as MessageEmbedOptions;
		await guildMember.send({ embeds: [embedMsg] });
	} else {
		const embedMsg: MessageEmbedOptionsSlash = generateTwitterEmbedItem(twitterUser) as MessageEmbedOptionsSlash;
		await ctx.send({ embeds: [embedMsg], ephemeral: true });
	}
	
	Log.debug('finished listing external accounts');
};

export const generateTwitterEmbedItem = (verifiedTwitter: VerifiedTwitter): MessageEmbedOptions | MessageEmbedOptionsSlash => {
	return {
		title: 'Twitter Authentication',
		description: 'Twitter account linked 👍',
		fields: [
			{ name: 'Display Name', value: `${verifiedTwitter.twitterUser.screen_name}` },
			{ name: 'Description', value: `${ServiceUtils.prepEmbedField(verifiedTwitter.twitterUser.description)}` },
			{ name: 'Profile', value: `https://twitter.com/${verifiedTwitter.twitterUser.screen_name}` },
		],
	};
};

export default ListAccounts;

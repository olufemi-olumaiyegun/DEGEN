import { GuildMember } from 'discord.js';
import { DiscordEvent } from '../types/discord/DiscordEvent';
import ServiceUtils from '../utils/ServiceUtils';
import { LogUtils } from '../utils/Log';
import { sendFqMessage } from '../service/first-quest/LaunchFirstQuest';
import client from '../app';
import { Captcha } from 'discord.js-captcha';
import constants from '../service/constants/constants';

export default class implements DiscordEvent {
	name = 'guildMemberAdd';
	once = false;

	async execute(member: GuildMember): Promise<any> {
		if (member.user.bot) return;
		try {
			if (ServiceUtils.isBanklessDAO(member.guild)) {
				if (await ServiceUtils.runUsernameSpamFilter(member)) {
					return;
				} else {
					if (member.partial) {
						member = await member.fetch();
					}

					const captcha = new Captcha(client, {
						guildID: member.guild.id,
						roleID: constants.FIRST_QUEST_ROLES.verified,
						channelID: process.env.DISCORD_CHANNEL_SUPPORT_ID,
						kickOnFailure: true,
						attempts: 3,
						timeout: 60000,
						showAttemptCount: true,
						// customPromptEmbed: null, // customise the embed that will be sent to the user when the captcha is requested
						// customSuccessEmbed: new MessageEmbed(), // customise the embed that will be sent to the user when the captcha is solved
						// customFailureEmbed: new MessageEmbed(), // customise the embed that will be sent to the user when they fail to solve the captcha
					});

					captcha.present(member);

					captcha.on('success', async () => {
						await new Promise(r => setTimeout(r, 1000));
						await sendFqMessage('undefined', member).catch(e => {
							LogUtils.logError('First attempt to launch first-quest failed: ', e);
						});
					});
				}
			}
		} catch (e) {
			LogUtils.logError('failed to process event guildMemberAdd', e);
		}
	}
}
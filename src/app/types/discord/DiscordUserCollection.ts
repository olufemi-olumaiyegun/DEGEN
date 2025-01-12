import {
	Collection,
	ObjectId,
} from 'mongodb';

export interface DiscordUserCollection extends Collection {
	_id: ObjectId,
	userId: string,
	tag: string,
	reportedForPOAP: number,
	isPremium: boolean,
	ethWalletSettings: {
		publicAddress: string[],
		isPOAPDeliveryEnabled: boolean,
	} | null
}

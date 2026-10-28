import { execute, parse } from 'graphql';
import { GraphQLSchemaHost } from '@nestjs/graphql';
import { UserService } from 'src/user/user.service';
import { PubSubService } from 'src/pubsub/pubsub.service';
import { createOIDCApplication } from './support/application';

describe('user deletion subscription verification state', () => {
  let f: Awaited<ReturnType<typeof createOIDCApplication>>;
  beforeAll(async () => {
    f = await createOIDCApplication();
  });
  afterAll(async () => {
    await f?.close();
  });
  afterEach(() => jest.restoreAllMocks());
  it.each([false, true])(
    'resolves the non-null emailVerified field for %s',
    async (emailVerified) => {
      const user = await f.prisma.user.create({
        data: {
          email: `delete-${emailVerified}@internal.example`,
          emailVerified,
        },
      });
      const publish = jest.spyOn(f.app.get(PubSubService), 'publish');
      expect((await f.app.get(UserService).deleteUserByUID(user)())._tag).toBe(
        'Right',
      );
      const event = publish.mock.calls.find(
        ([topic]) => topic === `user/${user.uid}/deleted`,
      )[1];
      const response = await execute({
        schema: f.app.get(GraphQLSchemaHost).schema,
        document: parse('subscription { userDeleted { uid emailVerified } }'),
        rootValue: event,
      });
      expect(response.errors).toBeUndefined();
      expect(response.data).toEqual({
        userDeleted: { uid: user.uid, emailVerified },
      });
    },
  );
});

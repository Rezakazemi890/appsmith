package com.appsmith.server.services.ce;

import com.appsmith.server.acl.AclPermission;
import com.appsmith.server.domains.User;
import com.appsmith.server.domains.UserGroup;
import com.appsmith.server.domains.UserInGroup;
import com.appsmith.server.repositories.UserGroupRepository;
import com.appsmith.server.services.AnalyticsService;
import com.appsmith.server.services.BaseService;
import org.springframework.data.mongodb.core.ReactiveMongoTemplate;
import org.springframework.data.mongodb.core.convert.MongoConverter;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Scheduler;

import java.util.List;
import java.util.stream.Collectors;

import javax.validation.Validator;

public class UserGroupServiceCEImpl extends BaseService<UserGroupRepository, UserGroup, String> implements UserGroupServiceCE{

    public UserGroupServiceCEImpl(Scheduler scheduler,
                                  Validator validator,
                                  MongoConverter mongoConverter,
                                  ReactiveMongoTemplate reactiveMongoTemplate,
                                  UserGroupRepository repository,
                                  AnalyticsService analyticsService) {

        super(scheduler, validator, mongoConverter, reactiveMongoTemplate, repository, analyticsService);
    }

    @Override
    public Mono<UserGroup> getById(String id, AclPermission permission) {
        return repository.findById(id, permission);
    }

    @Override
    public Mono<UserGroup> bulkAddUsers(UserGroup userGroup, List<User> users) {
        userGroup.getUsers().addAll(users.stream().map(user -> new UserInGroup(user)).collect(Collectors.toList()));
        return repository.updateById(userGroup.getId(), userGroup, AclPermission.MANAGE_USER_GROUPS);
    }

    @Override
    public Flux<UserGroup> getDefaultUserGroups(String workspaceId) {
        return repository.findByDefaultWorkspaceId(workspaceId);
    }
}

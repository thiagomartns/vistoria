using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Vistoria.Api.Infrastructure.Auth;
using Vistoria.Api.Model;
using Vistoria.Api.Repositories;
using Vistoria.Api.Repositories.Impl;
using Vistoria.Api.Services;
using Vistoria.Api.Services.Impl;

namespace Vistoria.Api.Configurations;

public static class AuthConfig
{
    // A chave do JWT é validada no start do host, exceto na geração do openapi.json no build, que roda sem segredo.
    public static IServiceCollection AddAuth(this IServiceCollection services, IConfiguration configuration)
    {
        var jwt = services.AddOptions<JwtOptions>().Bind(configuration.GetSection(JwtOptions.Section));
        if (!OpenApiConfig.IsBuildTimeGeneration)
        {
            jwt.ValidateOnStart();
        }

        services.AddSingleton<IValidateOptions<JwtOptions>, JwtOptionsValidator>();

        services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();
        services.AddSingleton<AccessTokenGenerator>();
        services.AddScoped<IUserRepository, UserRepository>();
        services.AddScoped<IAuthService, AuthService>();
        return services;
    }
}

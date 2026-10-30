using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Microsoft.Net.Http.Headers;
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

        // O JwtBearer lê a chave das JwtOptions só quando autentica, nunca no registro.
        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
        services.AddSingleton<IConfigureOptions<JwtBearerOptions>, JwtBearerSetup>();

        // Toda rota exige token; as públicas (/auth/*, health, documento OpenAPI) dizem isso com [AllowAnonymous].
        services.AddAuthorizationBuilder()
            .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

        services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();
        services.AddSingleton<AccessTokenGenerator>();
        services.AddScoped<IUserRepository, UserRepository>();
        services.AddScoped<IRefreshTokenRepository, RefreshTokenRepository>();
        services.AddScoped<IAuthService, AuthService>();
        return services;
    }

    public static WebApplication UseAuth(this WebApplication app)
    {
        app.UseAuthentication();
        app.UseAuthorization();
        return app;
    }

    /// <summary>
    /// Valida o que o <see cref="AccessTokenGenerator"/> emite: mesmo emissor, audiência e chave, só HS256.
    /// O prazo é conferido pelo <see cref="TimeProvider"/> (o falso nos testes), sem tolerância de relógio:
    /// quem emite e quem valida é a mesma API.
    /// </summary>
    private sealed class JwtBearerSetup(IOptions<JwtOptions> jwtOptions, TimeProvider time)
        : IConfigureNamedOptions<JwtBearerOptions>
    {
        public void Configure(string? name, JwtBearerOptions options)
        {
            if (name != JwtBearerDefaults.AuthenticationScheme)
            {
                return;
            }

            var jwt = jwtOptions.Value;
            options.MapInboundClaims = false;
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidIssuer = jwt.Issuer,
                ValidAudience = jwt.Audience,
                IssuerSigningKey = new SymmetricSecurityKey(jwt.SigningKeyBytes()),
                ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
                RequireExpirationTime = true,
                ClockSkew = TimeSpan.Zero,
                LifetimeValidator = (notBefore, expires, _, _) =>
                {
                    var now = time.GetUtcNow().UtcDateTime;
                    return (notBefore is null || now >= notBefore) && expires is { } exp && now < exp;
                },
            };
            options.Events = new JwtBearerEvents { OnChallenge = WriteUnauthorizedAsync };
        }

        public void Configure(JwtBearerOptions options) => Configure(Options.DefaultName, options);

        // Sem o handler, o 401 sairia sem corpo. O status basta: o ApplyCatalogType põe o type unauthorized.
        private static async Task WriteUnauthorizedAsync(JwtBearerChallengeContext context)
        {
            context.HandleResponse();
            var http = context.HttpContext;
            http.Response.StatusCode = StatusCodes.Status401Unauthorized;
            http.Response.Headers[HeaderNames.WWWAuthenticate] = JwtBearerDefaults.AuthenticationScheme;
            await http.RequestServices.GetRequiredService<IProblemDetailsService>().WriteAsync(new ProblemDetailsContext
            {
                HttpContext = http,
                ProblemDetails = { Status = StatusCodes.Status401Unauthorized },
            });
        }
    }
}

using Microsoft.AspNetCore.Identity;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.Auth;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model;
using Vistoria.Api.Repositories;

namespace Vistoria.Api.Services.Impl;

public class AuthService(
    IUserRepository users,
    IRefreshTokenRepository refreshTokens,
    IPasswordHasher<User> passwordHasher,
    AccessTokenGenerator tokens,
    TimeProvider time) : IAuthService
{
    private const string EmailField = "email";
    private const string EmailTaken = "E-mail já cadastrado.";

    // Hash de uma senha que ninguém tem: o signin de e-mail inexistente confere contra ele e custa o mesmo PBKDF2
    // que o de senha errada, então o tempo de resposta não revela quais e-mails têm conta.
    private static string? s_unknownUserHash;

    public async Task<AuthSession> SignUpAsync(SignUpDto request, CancellationToken cancellationToken)
    {
        var email = User.NormalizeEmail(request.Email);
        if (await users.EmailExistsAsync(email, cancellationToken))
        {
            throw new ValidationException(EmailField, EmailTaken);
        }

        var now = time.GetUtcNow();
        var user = new User
        {
            Id = Guid.CreateVersion7(now),
            Name = request.Name.Trim(),
            Email = email,
            CreatedAt = now,
        };
        user.PasswordHash = passwordHasher.HashPassword(user, request.Password);

        try
        {
            await users.AddAsync(user, cancellationToken);
        }
        catch (DuplicateEmailException)
        {
            // Dois cadastros com o mesmo e-mail passaram juntos pela checagem; o índice único decidiu.
            throw new ValidationException(EmailField, EmailTaken);
        }

        return await StartSessionAsync(user, cancellationToken);
    }

    public async Task<AuthSession> SignInAsync(SignInDto request, CancellationToken cancellationToken)
    {
        var user = await users.FindByEmailAsync(User.NormalizeEmail(request.Email), cancellationToken);
        if (user is null)
        {
            s_unknownUserHash ??= passwordHasher.HashPassword(new User(), Guid.NewGuid().ToString());
            passwordHasher.VerifyHashedPassword(new User(), s_unknownUserHash, request.Password);
            throw new InvalidCredentialsException();
        }

        switch (passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.Password))
        {
            case PasswordVerificationResult.Success:
                break;
            case PasswordVerificationResult.SuccessRehashNeeded:
                // Hash em formato ou custo antigo (como os SHA-256 do curso): regrava no atual, com a senha certa em mãos.
                user.PasswordHash = passwordHasher.HashPassword(user, request.Password);
                await users.UpdatePasswordHashAsync(user, cancellationToken);
                break;
            default:
                throw new InvalidCredentialsException();
        }

        return await StartSessionAsync(user, cancellationToken);
    }

    public async Task<RefreshResult> RefreshAsync(string? refreshToken, CancellationToken cancellationToken)
    {
        var hash = RefreshTokens.TryHash(refreshToken) ?? throw new UnauthorizedException();
        var token = await refreshTokens.FindByHashAsync(hash, cancellationToken) ?? throw new UnauthorizedException();
        var now = time.GetUtcNow();

        if (token is { RevokedAt: null, ReplacedAt: null } && !Expired(token, now))
        {
            // O UPDATE condicional decide qual de duas requisições com o mesmo cookie emite o sucessor.
            if (await refreshTokens.TryMarkReplacedAsync(token.Id, now, cancellationToken))
            {
                var successor = await IssueRefreshTokenAsync(
                    token.UserId, token.FamilyId, token.FamilyCreatedAt, now, cancellationToken);
                return new RefreshResult(await AccessTokenAsync(token.UserId, cancellationToken), successor);
            }

            // Perdeu: outra requisição substituiu (ou revogou) o token entre a leitura e o UPDATE.
            token = await refreshTokens.FindByHashAsync(hash, cancellationToken) ?? throw new UnauthorizedException();
        }

        if (token.RevokedAt is null && Expired(token, now))
        {
            // Fim natural da sessão, não sinal de roubo: a família fica como está.
            throw new UnauthorizedException();
        }

        if (token is { RevokedAt: null, ReplacedAt: { } replacedAt } && now - replacedAt < RefreshTokens.RotationGrace)
        {
            // Outra aba renovou há pouco com o mesmo cookie e o navegador já tem o sucessor: só o access token.
            return new RefreshResult(await AccessTokenAsync(token.UserId, cancellationToken), null);
        }

        // Reuso fora da tolerância, ou token revogado: quem tem o cookie pode não ser o dono da sessão.
        await refreshTokens.RevokeFamilyAsync(token.FamilyId, now, cancellationToken);
        throw new UnauthorizedException();
    }

    public async Task SignOutAsync(string? refreshToken, CancellationToken cancellationToken)
    {
        if (RefreshTokens.TryHash(refreshToken) is not { } hash
            || await refreshTokens.FindByHashAsync(hash, cancellationToken) is not { } token)
        {
            return;
        }

        // A família inteira: um token mais antigo dela que tenha vazado também deixa de valer.
        await refreshTokens.RevokeFamilyAsync(token.FamilyId, time.GetUtcNow(), cancellationToken);
    }

    private static bool Expired(RefreshToken token, DateTimeOffset now) =>
        now >= token.ExpiresAt || now >= token.FamilyCreatedAt + RefreshTokens.FamilyLifetime;

    private async Task<AuthSession> StartSessionAsync(User user, CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        var refreshToken = await IssueRefreshTokenAsync(user.Id, Guid.CreateVersion7(now), now, now, cancellationToken);
        var token = tokens.Create(user);
        return new AuthSession(
            new AuthDto(token.Token, token.ExpiresAt, new AuthUserDto(user.Id, user.Name)), refreshToken);
    }

    private async Task<IssuedRefreshToken> IssueRefreshTokenAsync(
        Guid userId, Guid familyId, DateTimeOffset familyCreatedAt, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var (value, hash) = RefreshTokens.Create();
        // O teto da família já sai no prazo do token, e com ele no Expires do cookie.
        var familyEnd = familyCreatedAt + RefreshTokens.FamilyLifetime;
        var expiresAt = now + RefreshTokens.Lifetime < familyEnd ? now + RefreshTokens.Lifetime : familyEnd;
        await refreshTokens.AddAsync(new RefreshToken
        {
            Id = Guid.CreateVersion7(now),
            TokenHash = hash,
            UserId = userId,
            FamilyId = familyId,
            FamilyCreatedAt = familyCreatedAt,
            CreatedAt = now,
            ExpiresAt = expiresAt,
        }, cancellationToken);
        return new IssuedRefreshToken(value, expiresAt);
    }

    private async Task<AccessTokenDto> AccessTokenAsync(Guid userId, CancellationToken cancellationToken)
    {
        var user = await users.FindByIdAsync(userId, cancellationToken) ?? throw new UnauthorizedException();
        var token = tokens.Create(user);
        return new AccessTokenDto(token.Token, token.ExpiresAt);
    }
}
